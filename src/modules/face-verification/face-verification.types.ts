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
  processing_time_ms: number;
  message?: string;
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
}
