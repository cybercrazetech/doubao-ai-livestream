export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface AudioVisualizerProps {
  stream: MediaStream | null;
  isActive: boolean;
  color?: string;
}

export interface LiveSessionConfig {
  model: string;
  systemInstruction?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}
