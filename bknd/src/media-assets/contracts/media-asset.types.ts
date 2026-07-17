export type MediaAssetKind =
  'reference-video' | 'practice-video' | 'cover-image' | 'extracted-frame';

export interface MediaAsset {
  id: string;
  kind: MediaAssetKind;
  storageUrl: string;
  mimeType: string;
  createdAt: string;
}
