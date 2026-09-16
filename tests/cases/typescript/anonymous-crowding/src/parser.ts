import { TokenKind } from './kind';

export function blockContent(k: TokenKind): string {
  return k === TokenKind.Word ? 'w' : 's';
}

export function blockTag(k: TokenKind): string {
  return k === TokenKind.Space ? 's' : 'w';
}
