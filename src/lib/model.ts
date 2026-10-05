export type RecognitionResult = {
  aksaraTerdeteksi: { aksara: string; latin: string; confidence: number }[];
  transkripsi: string;
  catatan?: string;
};
