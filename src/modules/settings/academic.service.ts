import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';

export interface AcademicItem { id: string; name: string; active: boolean; facultyId?: string; }
interface Catalog { revision: number; faculties: AcademicItem[]; programs: AcademicItem[]; }
export interface AcademicChange { revision: number; action: 'SAVE' | 'DELETE'; kind: 'FACULTY' | 'PROGRAM'; id?: string; name?: string; facultyId?: string; active?: boolean; }
const key = 'academic-catalog';
const isAcademicItem = (value: unknown): value is AcademicItem => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'string' && 'name' in value && typeof value.name === 'string'
  && 'active' in value && typeof value.active === 'boolean' && (!('facultyId' in value) || typeof value.facultyId === 'string');
export class AcademicService {
  static async read(db: Prisma.TransactionClient = prisma): Promise<Catalog> {
    const row = await db.systemSetting.findUnique({ where: { key } });
    if (!row) return { revision: 0, faculties: [], programs: [] };
    const value: unknown = JSON.parse(row.value);
    if (typeof value !== 'object' || value === null || !('revision' in value) || typeof value.revision !== 'number'
      || !Number.isInteger(value.revision) || value.revision < 0 || !('faculties' in value) || !Array.isArray(value.faculties)
      || !value.faculties.every(isAcademicItem) || !('programs' in value) || !Array.isArray(value.programs)
      || !value.programs.every(isAcademicItem)) throw new AppError('ข้อมูลคณะในระบบมีรูปแบบไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า', 500);
    return { revision: value.revision, faculties: value.faculties, programs: value.programs };
  }
  static async get(admin: boolean) {
    const catalog = await this.read();
    if (admin) return catalog;
    const faculties = catalog.faculties.filter(item => item.active);
    return { ...catalog, faculties, programs: catalog.programs.filter(item => item.active && faculties.some(faculty => faculty.id === item.facultyId)) };
  }
  static async validateSelection(course: string, facultyId: string | undefined, db: Prisma.TransactionClient) {
    await db.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(756031)`;
    const catalog = await this.read(db);
    // Preserve legacy deployments until an administrator configures the catalogue.
    if (!catalog.programs.length && catalog.revision === 0) return undefined;
    const selectedFaculty = catalog.faculties.find(item => item.name === course.trim() && item.active && (!facultyId || item.id === facultyId));
    if (selectedFaculty) return selectedFaculty.name;
    const program = catalog.programs.find(item => item.name === course.trim() && item.active && (!facultyId || item.facultyId === facultyId));
    const faculty = catalog.faculties.find(item => item.id === program?.facultyId && item.active);
    if (!program || !faculty) throw new AppError('กรุณาเลือกคณะที่เปิดใช้งานจากรายการ', 400);
    return faculty.name;
  }
  static async change(input: AcademicChange, userId: number) {
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(756031)`;
      const catalog = await this.read(db);
      if (catalog.revision !== input.revision) throw new AppError('รายการมีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนบันทึก', 409);
      const items = input.kind === 'FACULTY' ? catalog.faculties : catalog.programs;
      const existing = items.find(item => item.id === input.id);
      if (input.id && !existing) throw new AppError('ไม่พบรายการ', 404);
      if (input.action === 'DELETE') {
        if (!existing) throw new AppError('กรุณาเลือกรายการที่จะลบ', 400);
        if (input.kind === 'FACULTY' && catalog.programs.some(item => item.facultyId === existing.id)) throw new AppError('คณะนี้มีหลักสูตร กรุณาปิดใช้งานแทนการลบ', 409);
      }
      const name = input.name?.trim();
      if (input.action === 'SAVE' && (!name || name.length > 160)) throw new AppError('กรุณากรอกชื่อไม่เกิน 160 ตัวอักษร', 400);
      if (input.action === 'SAVE' && items.some(item => item.id !== input.id && item.name.normalize('NFKC').toLowerCase() === name!.normalize('NFKC').toLowerCase())) throw new AppError('ชื่อรายการนี้มีอยู่แล้ว', 409);
      if (input.kind === 'PROGRAM' && input.action === 'SAVE' && !catalog.faculties.some(item => item.id === input.facultyId && (item.active || existing?.facultyId === item.id && input.active === false))) throw new AppError('กรุณาเลือกคณะที่เปิดใช้งาน', 400);
      if (existing && (input.action === 'DELETE' || name !== existing.name || input.kind === 'PROGRAM' && input.facultyId !== existing.facultyId)) {
        const used = await db.tenant.count({ where: { course: existing.name } });
        const drafts = await db.housingApplicationDraft.count({ where: { data: { path: ['personalInformation', 'course'], equals: existing.name } } });
        if (used || drafts) throw new AppError('มีผู้พักหรือฉบับร่างใช้รายการนี้แล้ว กรุณาปิดใช้งานแทนการลบหรือเปลี่ยนชื่อ', 409);
      }
      if (input.action === 'DELETE') items.splice(items.indexOf(existing!), 1);
      else if (existing) Object.assign(existing, { name, active: input.active ?? true, ...(input.kind === 'PROGRAM' ? { facultyId: input.facultyId } : {}) });
      else items.push({ id: randomUUID(), name: name!, active: input.active ?? true, ...(input.kind === 'PROGRAM' ? { facultyId: input.facultyId } : {}) });
      catalog.revision++;
      await db.systemSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(catalog), category: 'ACADEMIC_CATALOG', updatedById: userId }, update: { value: JSON.stringify(catalog), updatedById: userId } });
      return catalog;
    });
  }
}
