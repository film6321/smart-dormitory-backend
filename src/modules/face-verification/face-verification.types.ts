import type { CleanupReceipt } from './face-cleanup.service';
export interface FaceRegisterResponse {
  success: boolean;
  message: string;
  data: {
    id: number;
    user_id: number;
    model_name: string;
    embedding_version: string;
    created_at: string;
    updated_at: string;
  };
}

export interface FaceVerifyResponse {
  matched: boolean;
  user_id: number | null;
  similarity: number;
  score_available?: boolean;
  processing_time_ms: number;
  message?: string;
  verification_available?: boolean;
  reason?: 'NO_FACE_DETECTED' | 'MULTIPLE_FACES_DETECTED' | 'NOT_MATCHED' | 'MATCHED' | 'UNAVAILABLE';
}

export interface FaceTemplateResponse {
  id: number;
  user_id: number;
  model_name: string;
  embedding_version: string;
  created_at: string;
  updated_at: string;
}

export interface FaceDeleteResponse {
  success: boolean;
  message: string;
  cleanup?: CleanupReceipt;
  reEnrollmentReady?: boolean;
}
