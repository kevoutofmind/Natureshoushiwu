export interface TeachingWorkspaceResponse {
  success: boolean;
  code: string;
  message: string;
  data: {
    selectedDanceId: string | null;
    capabilities: {
      cameraRecording: boolean;
      localDrafts: boolean;
      voiceControl: boolean;
      vlmCoaching: boolean;
    };
  };
}
