export interface VerifyIdCardRequest {
  imageBase64: string;
}

export interface VerifyIdCardOptions {
  userId?: number;
}

export interface OcrIdCardData {
  citizen_id?: string;
  id_number?: string;
  th_name?: string;
  bp_full_name_th?: string;
  th_dob?: string;
  dob_th?: string;
  address?: string;
  address_th?: string;
  th_address?: string;
  issue_date?: string;
  expiry_date?: string;
}

export interface OcrIdCardResponse {
  success?: boolean;
  message?: string;
  error?: string;
  id_detected?: boolean;
  data?: OcrIdCardData;
  validation?: {
    id_present?: boolean;
    id_checksum_valid?: boolean;
  };
  processing_time_ms?: number;
  job_id?: string;
  citizen_id?: string;
  id_number?: string;
  birth_date?: string;
  birthDate?: string;
  date_of_birth?: string;
  address?: string;
  address_th?: string;
  th_address?: string;
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
