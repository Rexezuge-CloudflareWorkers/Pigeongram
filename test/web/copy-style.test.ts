import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loginPhaseMessage } from '../../apps/web/src/api';
import { formatListStamp, formatPresence, mediaPreview, pollPreview, previewOf } from '../../apps/web/src/format';
import type { MessagePollDto, PresenceDto } from '../../apps/web/src/types';

/**
 * The visible-copy style: every word of authored, user-visible text is
 * capitalised, including articles, prepositions and conjunctions. Accessible
 * only copy (`aria-label`, `title`, `alt`, `sr-only`) keeps sentence case,
 * because it is not visible text.
 *
 * The guard parses the SPA's TSX with the TypeScript AST: JSX text nodes, the
 * static half of a template, and `placeholder` values are all checked. Dynamic
 * values (chat titles, dates, counters, units) belong to their own casing and
 * are skipped token by token.
 */

// The suite's working directory is the repository root (Vitest's `root`), and
// an `import.meta.url` under the test transform is not a file URL.
const WEB_SRC = path.resolve(process.cwd(), 'apps/web/src');

/**
Unit suffixes that legitimately follow a dynamic value: `${n}s`, `${n}m`.
*/
const UNIT_SUFFIXES = new Set(['s', 'm', 'h', 'd']);

function isTitleCased(text: string): boolean {
  for (const rawToken of text.split(/\s+/)) {
    const start = rawToken.search(/[\p{L}\p{N}]/u);
    if (start === -1) continue;
    const token = rawToken.slice(start);
    // A counter or a unit (`5m`, `30s`, `1.2K`) starts with a digit and is
    // data, not authored copy.
    if (/^\p{N}/u.test(token)) continue;
    if (UNIT_SUFFIXES.has(token)) continue;
    // A hyphenated compound is one word, so every segment is capitalised
    // (`Diffie-Hellman`, `Single-Account`); a contraction only needs its first
    // letter (`You'll`).
    for (const segment of token.split('-')) {
      const first = /\p{L}/u.exec(segment)?.[0];
      if (first !== undefined && first !== first.toUpperCase()) return false;
    }
  }
  return true;
}

function hasCopy(text: string): boolean {
  return /\p{L}/u.test(text);
}

function srOnly(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  return node.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'className') return false;
    const initializer = attribute.initializer;
    if (initializer === undefined) return false;
    if (ts.isStringLiteral(initializer)) return initializer.text.split(/\s+/).includes('sr-only');
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      return initializer.expression.getText().includes('sr-only');
    }
    return false;
  });
}

function staticStrings(expression: ts.Expression): string[] {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...staticStrings(node.whenTrue), ...staticStrings(node.whenFalse)];
  }
  return [];
}

function walkSourceFile(sourceFile: ts.SourceFile, source: string, visit: (text: string, node: ts.Node) => void): void {
  const walk = (node: ts.Node, inSrOnly: boolean): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const children = ts.isJsxElement(node) ? node.children : undefined;
      const nextSrOnly = inSrOnly || srOnly(opening);
      if (children !== undefined) {
        for (const child of children) walk(child, nextSrOnly);
      }
      return;
    }
    if (inSrOnly) return;
    if (ts.isJsxText(node)) {
      // `getStart()`/`getEnd()` keep the original whitespace; `node.text` has
      // already had the JSX whitespace rules applied.
      visit(source.slice(node.getStart(sourceFile), node.getEnd()), node);
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression === undefined) return;
      const parent = node.parent;
      const isChild = parent !== undefined && ts.isJsxElement(parent) && parent.children.includes(node);
      if (!isChild) return;
      for (const text of staticStrings(node.expression)) visit(text, node);
      return;
    }
    ts.forEachChild(node, (child) => walk(child, inSrOnly));
  };
  walk(sourceFile, false);

  // Placeholders are visible inside their inputs, so they carry the same rule.
  const visitPlaceholders = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText() === 'placeholder' && node.initializer !== undefined) {
      const initializer = node.initializer;
      if (ts.isStringLiteral(initializer)) {
        visit(initializer.text, node);
      } else if (ts.isJsxExpression(initializer) && initializer.expression) {
        for (const text of staticStrings(initializer.expression)) visit(text, node);
      }
    }
    ts.forEachChild(node, visitPlaceholders);
  };
  visitPlaceholders(sourceFile);
}

function tsxFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsxFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(entryPath);
  }
  return files;
}

function offendersInFile(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];
  walkSourceFile(sourceFile, source, (text, node) => {
    const collapsed = text.replaceAll(/\s+/g, ' ').trim();
    if (collapsed === '' || !hasCopy(collapsed) || isTitleCased(collapsed)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    offenders.push(`${file.slice(WEB_SRC.length)}:${String(line + 1)} — ${collapsed}`);
  });
  return offenders;
}

function presence(lastSeenAt: number | null, status: PresenceDto['status']): PresenceDto {
  return { status, lastSeenAt };
}

const POLL: MessagePollDto = {
  id: '1',
  question: 'Where?',
  answers: [],
  totalVoters: 0,
  closed: false,
  quiz: false,
  multiple: false,
  revotingDisabled: false,
  hideResultsUntilClose: false,
  solution: null,
};

describe('visible copy style', () => {
  it('title-cases every JSX text node and placeholder under apps/web/src', () => {
    const failures = tsxFiles(WEB_SRC).flatMap(offendersInFile);
    expect(failures).toEqual([]);
  });

  it('title-cases authored presence and preview helpers', () => {
    expect(formatPresence(presence(null, 'online'))).toBe('Online');
    expect(formatPresence(presence(null, 'recently'))).toBe('Last Seen Recently');
    expect(formatPresence(presence(null, 'within_week'))).toBe('Last Seen Within A Week');
    expect(formatPresence(presence(null, 'within_month'))).toBe('Last Seen Within A Month');
    expect(formatPresence(presence(0, 'offline'))).toMatch(/^Last Seen .+ At .+$/);
    expect(mediaPreview('voice')).toBe('Voice Message');
    expect(mediaPreview('unsupported')).toBe('Unsupported Message');
    expect(pollPreview(POLL)).toBe('Poll: Where?');
    expect(formatListStamp(Date.now())).toBe('Now');
    expect(previewOf('', null, POLL)).toBe('Poll: Where?');
  });

  it('title-cases the authored login phases', () => {
    expect(loginPhaseMessage(null)).toBe('Connecting To The Session Engine…');
    expect(loginPhaseMessage({ phase: 'qr', authorized: false, me: null })).toMatch(/^Scan This QR Code From Telegram/);
    expect(loginPhaseMessage({ phase: 'code', authorized: false, me: null, codeType: 'app' })).toBe(
      'Telegram Sent A Login Code To Your Telegram App — Type It Below',
    );
    expect(loginPhaseMessage({ phase: 'password', authorized: false, me: null })).toBe(
      'Two-Step Verification: Enter Your Telegram Cloud Password',
    );
  });
});
