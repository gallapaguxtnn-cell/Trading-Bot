export interface ListenKeyResponse {
  listenKey: string;
}

export interface ConnectionMetadata {
  ws: any;
  listenKey: string;
  renewalInterval: NodeJS.Timeout;
  strategy: {
    id: string;
    apiKey: string;
    apiSecret: string;
    isTestnet: boolean;
  };
  lastMessageAt: number;
  reconnectAttempts: number;
}

export interface MarketDataConnection {
  ws: any;
  symbols: Set<string>;
  refCounts: Map<string, number>;
  lastMessageAt: number;
  isTestnet: boolean;
}

export interface WebSocketHealth {
  userDataStreams: {
    strategyId: string;
    connected: boolean;
    lastMessageAt: number;
    reconnectAttempts: number;
  }[];
  marketDataStreams: {
    isTestnet: boolean;
    connected: boolean;
    symbols: string[];
    lastMessageAt: number;
  }[];
  messagesPerMinute: number;
}
