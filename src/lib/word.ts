import { AlignmentType, Document, Footer, Header, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { audit } from './audit';
import type { Ctx } from './authz';
import { getDraft, needsChecking, type Block } from './drafts';

/** Editable Word export (FR-011/FR-013). Works without AI. Status is stamped so a draft is never mistaken for approved work. */
export async function exportDraftDocx(ctx: Ctx, draftId: string, version?: number) {
  const { draft, version: v, approval } = await getDraft(ctx, draftId, version);
  const approved = approval && approval.target_version === v.version && draft.status === 'approved';
  const banner = approved
    ? `Lawyer approved — version ${v.version} by ${approval!.actor_name} on ${new Date(approval!.created_at).toISOString().slice(0, 10)}`
    : `DRAFT ONLY — version ${v.version} — not lawyer approved`;

  const para = (blk: Block): Paragraph[] => {
    const lines = blk.text.split('\n');
    if (blk.kind === 'title') return [new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: blk.text, bold: true })] })];
    if (blk.kind === 'heading') return [new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: blk.text, bold: true })] })];
    if (blk.kind === 'caption') return lines.map((l) => new Paragraph({ children: [new TextRun(l)] }));
    const runs: TextRun[] = [];
    lines.forEach((l, i) => runs.push(new TextRun({ text: l, break: i > 0 ? 1 : 0, italics: blk.kind === 'note' })));
    if (blk.claim) {
      const label = blk.claim.status === 'verified' ? 'Verified source' : blk.claim.status === 'needs_checking' ? 'Needs checking' : 'Unverified';
      runs.push(new TextRun({ text: ` [${label}]`, color: blk.claim.status === 'verified' ? '1F5E3B' : 'A33A00', size: 18 }));
    }
    return [new Paragraph({ spacing: { after: 160 }, alignment: AlignmentType.JUSTIFIED, children: runs })];
  };

  const sources = new Map<string, string>();
  for (const blk of v.content.blocks) for (const c of blk.claim?.citations ?? []) {
    sources.set(c.passage_id, `${c.source_title}, ${c.locator}${c.version_label ? ` (version ${c.version_label}` : ''}${c.checked_at ? `, last checked ${c.checked_at.slice(0, 10)})` : c.version_label ? ')' : ''}`);
  }
  const open = needsChecking(v.content);

  const doc = new Document({
    creator: 'LEXIA Counsel',
    title: draft.title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: banner, size: 16, color: approved ? '1F5E3B' : 'A33A00' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Prepared with LEXIA. Not filed, served or sent by LEXIA.', size: 16 })] })] }) },
      children: [
        ...v.content.blocks.flatMap(para),
        new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true, children: [new TextRun('Source and review annex')] }),
        new Paragraph({ children: [new TextRun({ text: 'Citations resolve to the passages below. A citation is not proof that an authority remains good law.', italics: true })] }),
        ...(sources.size ? [...sources.values()].map((s) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(s)] })) : [new Paragraph('No sources cited.')]),
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(`Open review items at export: ${open.length}`)] }),
        ...open.map((o) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(`${o.label}: ${o.reasons.join(' ')}`)] })),
        ...(v.content.personalization.effective !== 'neutral' ? [new Paragraph({ children: [new TextRun({ text: `Personalization: ${v.content.personalization.effective} (Writing DNA v${v.content.personalization.writing_version ?? '—'}, Reasoning DNA v${v.content.personalization.reasoning_version ?? '—'}).`, italics: true })] })] : []),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'draft.export_word', targetType: 'draft', targetId: draftId, meta: { version: v.version, approved: !!approved } });
  const safe = draft.title.replace(/[^\w\- ]+/g, '').slice(0, 60).trim() || 'draft';
  return { filename: `${safe} v${v.version}${approved ? '' : ' DRAFT'}.docx`, bytes: new Uint8Array(buf) };
}
