# 09. Face Recognition Service

## Registration Flow

Register Face
↓
Detect Face
↓
Alignment
↓
Embedding
↓
Save

## Verification Flow

Image
↓
Embedding
↓
Compare
↓
Similarity
↓
Result

## Notes

- Face data should be processed through an external face recognition service.
- Verification output should be returned as a structured result with confidence score.
