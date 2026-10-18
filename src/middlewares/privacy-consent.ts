import { requestBody } from '../shared/input';
import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth-jwt';
import { AppError } from './error-handler';
import { PrivacyConsentService, PrivacyPurpose } from '../modules/users/privacy-consent.service';

export const requirePrivacyConsent = (purpose: PrivacyPurpose, targetFromBody = false) =>
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const userId = targetFromBody ? Number(requestBody(req.body)?.userId || requestBody(req.body)?.user_id) : req.user?.id;
      if (!userId || !Number.isInteger(userId) || userId < 1) throw new AppError('Invalid user', 400);
      await PrivacyConsentService.require(userId, purpose);
      next();
    } catch (error) { next(error); }
  };
