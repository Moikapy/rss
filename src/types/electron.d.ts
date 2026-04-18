export {};

declare global {
  interface Window {
    electronAPI?: {
      refreshFeeds: () => void;
      onRefreshFeeds: (callback: () => void) => () => void;
      platform: string;
      isElectron: boolean;
    };
  }
}