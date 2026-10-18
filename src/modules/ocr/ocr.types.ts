export interface VerifyIdCardRequest {
  imageBase64: string;
}

export interface VerifyIdCardOptions {
  userId?: number;
}

export interface OcrIdCardData {
  citizen_id?: string | null;
  id_number?: string | null;
  th_name?: string | null;
  bp_full_name_th?: string | null;
  th_dob?: string | null;
  dob_th?: string | null;
  address?: string | null;
  address_th?: string | null;
  th_address?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
}

export interface OcrIdCardResponse {
  success?: boolean;
  message?: string | null;
  error?: string | null;
  id_detected?: boolean;
  data?: OcrIdCardData;
  validation?: {
    id_present?: boolean;
    id_checksum_valid?: boolean;
  };
  processing_time_ms?: number;
  job_id?: string | null;
  citizen_id?: string | null;
  id_number?: string | null;
  birth_date?: string | null;
  birthDate?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  address_th?: string | null;
  th_address?: string | null;
}

export interface VerifyIdCardResult {
  verificationId?: number;
  isThaiIdCard: boolean;
  reason?: string;
  citizenId?: string;
  address?: string;
  age?: number;
  imagePath?: string;
  citizenIdMasked?: string;
  fullNameTh?: string;
  birthDateTh?: string;
  issueDate?: string;
  expiryDate?: string;
  confidence: {
    idDetected: boolean;
    idPresent: boolean;
    idChecksumValid: boolean;
  };
  processingTimeMs?: number;
  jobId?: string;
}

export interface DeleteIdCardVerificationResult {
  id: number;
  imageDeleted: boolean;
}

export interface IdCardVerificationSummary {
  id: number;
  userId?: number | null;
  isThaiIdCard: boolean;
  citizenIdMasked?: string | null;
  fullNameTh?: string | null;
  birthDateTh?: string | null;
  idDetected: boolean;
  idPresent: boolean;
  idChecksumValid: boolean;
  hasImage: boolean;
  reason?: string | null;
  verifiedAt: Date;
  createdAt: Date;
}

export interface IdCardVerificationDetail extends IdCardVerificationSummary {
  issueDate?: string | null;
  expiryDate?: string | null;
  ocrJobId?: string | null;
  processingTimeMs?: number | null;
}

export interface ListIdCardVerificationsResult {
  items: IdCardVerificationSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IdCardVerificationImageResult {
  absolutePath: string;
  contentType: string;
}

export interface OcrJobSummary {
  id: string;
  userId?: number | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  resultVerificationId?: number | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface CreateOcrJobResult extends OcrJobSummary {}
