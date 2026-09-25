import { createHmac, timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';
import PDFDocument from 'pdfkit';

import { formatUGX } from '@/utils/format';

import { loadUser } from './auth';
import { config } from './config';
import { pool, query } from './db';
import { E } from './errors';
import { expandJob } from './jobs';
import { baseUrl } from './media';
import type { JobRow } from './types';

const TTL_SECONDS = 15 * 60;
const sign = (jobId: number, userId: number, exp: number) =>
  createHmac('sha256', config.jwtSecret).update(`receipt:${jobId}:${userId}:${exp}`).digest('hex');

/** Query string for a signed, 15-minute receipt link (receipts are never public). */
export function signReceipt(jobId: number, userId: number): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `u=${userId}&exp=${exp}&sig=${sign(jobId, userId, exp)}`;
}

/** GET /receipts/:id.pdf?u&exp&sig — PDF rendered on demand (PDFKit, §4). */
export const serveReceipt: RequestHandler = async (req, res) => {
  const jobId = Number(String(req.params.id).replace(/\.pdf$/, ''));
  const userId = Number(req.query.u);
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? '');
  const expected = sign(jobId, userId, exp);
  if (!exp || exp < Date.now() / 1000 || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw E.forbidden('This receipt link has expired. Open it again from the app.');
  }
  const viewer = await loadUser(userId);
  const row = (await query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jobId]))[0];
  if (!viewer || !row || (row.owner_id !== viewer.id && row.mechanic_id !== viewer.id) || row.status !== 'completed') throw E.notFound('Receipt');
  const job = await expandJob(pool, baseUrl(req), row, viewer);
  const totals = job.totals!;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="mycarrepair-receipt-${job.id}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(res);
  const navy = '#0f172a';
  const muted = '#64748b';
  doc.fillColor('#F97316').fontSize(22).text('MyCarRepair', { continued: true }).fillColor(navy).text('  Receipt');
  doc.fillColor(muted).fontSize(10).text(`Trusted mechanics, anytime, anywhere · Kampala`).moveDown(0.5);
  doc.fillColor(navy).fontSize(11).text(`Job #${job.id} · ${job.updatedAt.slice(0, 16).replace('T', ' ')} UTC`).moveDown();

  const line = (label: string, value: string) => doc.fillColor(muted).text(label, { continued: true, width: 140 }).fillColor(navy).text(`   ${value}`);
  line('Service', `${job.serviceType}${job.sosActive ? ' (SOS)' : ''}`);
  if (job.vehicle) line('Vehicle', `${job.vehicle.make} ${job.vehicle.model} ${job.vehicle.year} · ${job.vehicle.plateNumber}`);
  if (job.mechanic) line('Mechanic', `${job.mechanic.fullName}${job.mechanic.garageName ? ` · ${job.mechanic.garageName}` : ''}`);
  if (job.owner) line('Customer', job.owner.fullName);
  doc.moveDown();

  doc.fillColor(navy).fontSize(13).text('Charges').fontSize(11).moveDown(0.3);
  const charge = (label: string, amount: number) => {
    const y = doc.y;
    doc.fillColor(navy).text(label, 48, y, { width: 350 });
    doc.text(formatUGX(amount), 400, y, { width: 147, align: 'right' });
  };
  charge('Service fee', totals.serviceFee);
  for (const q of job.quotes ?? []) if (q.isApproved === true) charge(`${q.partName} (approved part)`, q.price);
  doc.moveDown(0.3).moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(navy).stroke().moveDown(0.3);
  doc.fontSize(13);
  charge('Total', totals.total);
  doc.fontSize(10).moveDown();

  const declined = (job.quotes ?? []).filter((q) => q.isApproved === false);
  if (declined.length) {
    doc.fillColor(muted).text(`Declined quotes (not billed): ${declined.map((q) => `${q.partName} ${formatUGX(q.price)}`).join(', ')}`, 48).moveDown();
  }
  if (job.checklist?.length) {
    doc.fillColor(navy).fontSize(13).text('Work completed', 48).fontSize(10).moveDown(0.3);
    for (const t of job.checklist) doc.fillColor(navy).text(`${t.isCompleted ? '✓' : '○'}  ${t.taskDescription}`);
    doc.moveDown();
  }
  doc.fillColor(muted).text('Every part on this receipt was approved by the vehicle owner before billing.');
  doc.end();
};
