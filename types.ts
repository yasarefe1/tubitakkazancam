export enum AppMode {
  IDLE = 'BEKLEMEDE',
  SCAN = 'TARAMA',
  READ = 'OKUMA',
  NAVIGATE = 'YOL TARİFİ',
  EMERGENCY = 'ACİL DURUM'
}

export interface BoundingBox {
  label: string;
  ymin: number; // 0-100 percentage
  xmin: number; // 0-100 percentage
  ymax: number; // 0-100 percentage
  xmax: number; // 0-100 percentage
  confidence?: number; // 0-1 score
}

export interface AnalysisResult {
  text: string;
  boxes: BoundingBox[];
}

export interface CameraHandle {
  takePhoto: () => string | null; // Returns base64 image
  toggleTorch: (on: boolean) => Promise<void>; // Controls flashlight
  setZoom: (level: number) => Promise<void>; // Controls digital zoom
  switchCamera: () => Promise<void>; // Toggles between front/back
  getVideoElement: () => HTMLVideoElement | null; // For object detection
}