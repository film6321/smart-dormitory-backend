import { AppError } from '../../middlewares/error-handler';
import NotificationService from '../notifications/notification.service';
import { BillingRepository } from './billing.repository';

export class BillingService {
  static async listBills(userId?: number, role?: string) {
    return BillingRepository.listBills(userId, role);
  }

  static async getBillById(id: number) {
    return BillingRepository.findBillById(id);
  }

  static async uploadSlip(billId: number, slipHash: string) {
    const bill = await BillingRepository.findBillById(billId);
    if (!bill) {
      throw new AppError('Bill not found', 404);
    }

    return BillingRepository.updateBill(billId, {
      status: 'VERIFYING',
      slipHash,
      reason: 'OCR pending',
      version: bill.version + 1,
    });
  }

  static async updateBillStatus(billId: number, status: string, reason?: string) {
    const updated = await BillingRepository.updateBill(billId, {
      status: status as any,
      reason,
      version: { increment: 1 },
    });

    if (status === 'OVERDUE') {
      const notificationService = new NotificationService();
      await notificationService.scheduleNotification({
        tenantId: updated.tenantId,
        channel: 'SMS',
        type: 'RENT_OVERDUE',
        payload: JSON.stringify({ message: `Bill ${updated.id} is overdue`, amount: updated.amount.toString() }),
      });
    }

    return updated;
  }
}
