import {
  action,
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
  private currentAccessToken: string = "";

  override async onWillAppear(ev: WillAppearEvent<GA4Settings>): Promise<void> {
    const settings = ev.payload.settings;
    console.log("settings", settings);
    // アクセストークンの初期取得
    await this.refreshAccessToken(ev.payload.settings);

    // アクセストークンの自動更新（50分ごと）
    this.tokenRefreshIntervalId = setInterval(() => {
      this.refreshAccessToken(ev.payload.settings);
    }, 50 * 60 * 1000);

    // 初期表示
    const activeUsers = await this.updateActiveUsers(ev.payload.settings);
    await ev.action.setTitle(activeUsers);

    // 10分ごとに更新
    this.intervalId = setInterval(async () => {
      const activeUsers = await this.updateActiveUsers(ev.payload.settings);
      await ev.action.setTitle(activeUsers);
    }, 10 * 60 * 1000);
  }

  override onWillDisappear(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.tokenRefreshIntervalId) {
      clearInterval(this.tokenRefreshIntervalId);
      this.tokenRefreshIntervalId = null;
    }
  }

  private async refreshAccessToken(settings: GA4Settings): Promise<void> {
    try {
      console.log("clientId", settings.clientId);
      console.log("clientSecret", settings.clientSecret);
      console.log("refreshToken", settings.refreshToken);
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
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = (await response.json()) as TokenResponse;
      this.currentAccessToken = data.access_token;
    } catch (error) {
      console.error("Error refreshing token:", error);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<GA4Settings>): Promise<void> {
    const { settings } = ev.payload;

    await ev.action.setTitle("-");

    // TODO: https://analytics.google.com/analytics/web/#/p473333751 をひらく

    const activeUsers = await this.updateActiveUsers(settings);

    await ev.action.setTitle(activeUsers);
  }

  private async updateActiveUsers(settings: GA4Settings): Promise<string> {
    try {
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
        throw new Error("Rate limit exceeded");
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
}
