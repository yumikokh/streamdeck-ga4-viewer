import streamDeck, {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

/**
 * Settings for GA4RealtimeViewer.
 */
type GA4Settings = {
  propertyId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

interface GA4Response {
  rows?: Array<{
    metricValues?: Array<{
      value?: string;
    }>;
  }>;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

@action({ UUID: "com.yumikokh.streamdeck-ga4-viewer.realtime" })
export class GA4RealtimeViewer extends SingletonAction<GA4Settings> {
  private intervalId: NodeJS.Timeout | null = null;
  private tokenRefreshIntervalId: NodeJS.Timeout | null = null;
  private currentAccessToken: string | null = null;
  private tokenRefreshPromise: Promise<void> | null = null;

  private openAnalyticsUrl(propertyId: string): void {
    try {
      const analyticsUrl = `https://analytics.google.com/analytics/web/#/p${propertyId}`;
      streamDeck.system.openUrl(analyticsUrl);
    } catch (error) {
      console.error("Error opening Google Analytics:", error);
    }
  }

  private async refreshAccessToken(settings: GA4Settings): Promise<void> {
    try {
      streamDeck.logger.info("=== refreshAccessToken ===", settings);
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          refresh_token: settings.refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as TokenResponse;
        streamDeck.logger.error("Token refresh error details:", {
          status: response.status,
          error: errorData,
        });

        throw new Error(
          `Token refresh failed: ${response.status} - ${JSON.stringify(
            errorData
          )}`
        );
      }

      const data = (await response.json()) as TokenResponse;
      this.currentAccessToken = data.access_token;
      streamDeck.logger.info("Token refresh successful");
    } catch (error) {
      streamDeck.logger.error("Error in refreshAccessToken:", error);
    }
  }

  private async updateActiveUsers(settings: GA4Settings): Promise<string> {
    try {
      if (!this.currentAccessToken) {
        throw new Error("Access token is null");
      }
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${settings.propertyId}:runRealtimeReport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.currentAccessToken}`,
          },
          body: JSON.stringify({
            metrics: [{ name: "activeUsers" }],
          }),
        }
      );

      if (response.status === 429) {
        throw new Error(`Rate limit exceeded: ${response.status}`);
      }
      if (response.status === 401) {
        throw new Error(`Unauthorized: ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as GA4Response;
      const activeUsers = data.rows?.[0]?.metricValues?.[0]?.value || "0";
      return activeUsers;
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error fetching GA4 data:", error.message);
        return error.message;
      }
      return "Error";
    }
  }

  private async refreshTokenAndUpdateActiveUsers(
    settings: GA4Settings
  ): Promise<string> {
    await this.refreshAccessToken(settings);
    const activeUsers = await this.updateActiveUsers(settings);
    return activeUsers;
  }

  // ----------------------------------- //

  override async onWillAppear(ev: WillAppearEvent<GA4Settings>): Promise<void> {
    streamDeck.logger.info("=== onWillAppear ===", ev.payload.settings);

    const activeUsers = await this.refreshTokenAndUpdateActiveUsers(
      ev.payload.settings
    );
    await ev.action.setTitle(activeUsers);

    // アクセストークンの自動更新（50分ごと）
    if (!this.tokenRefreshIntervalId) {
      this.tokenRefreshIntervalId = setInterval(() => {
        this.refreshAccessToken(ev.payload.settings);
      }, 50 * 60 * 1000);
    }

    // 10分ごとに更新
    if (!this.intervalId) {
      this.intervalId = setInterval(async () => {
        if (!!this.tokenRefreshPromise) {
          await this.tokenRefreshPromise;
        }
        const activeUsers = await this.updateActiveUsers(ev.payload.settings);
        await ev.action.setTitle(activeUsers);
      }, 10 * 60 * 1000);
    }
  }

  override onWillDisappear(): void {
    streamDeck.logger.info("=== onWillDisappear ===");

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.tokenRefreshIntervalId) {
      clearInterval(this.tokenRefreshIntervalId);
      this.tokenRefreshIntervalId = null;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<GA4Settings>): Promise<void> {
    const { settings } = ev.payload;
    streamDeck.logger.info("=== onKeyDown ===", settings);
    await ev.action.setTitle("-");
    this.openAnalyticsUrl(settings.propertyId);
    const activeUsers = await this.updateActiveUsers(settings);
    await ev.action.setTitle(activeUsers);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<GA4Settings>
  ): Promise<void> {
    streamDeck.logger.info("=== onDidReceiveSettings ===", ev.payload.settings);
    const activeUsers = await this.refreshTokenAndUpdateActiveUsers(
      ev.payload.settings
    );
    await ev.action.setTitle(activeUsers);
  }
}
