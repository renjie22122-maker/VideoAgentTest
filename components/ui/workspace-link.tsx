'use client';
import type { ReactNode } from 'react';
import { buttonVariants } from './button';

/** Read-only navigation remains available inside a locked production form. */
export function WorkspaceLink({ children, href, onNavigate, disabled = false, className, plain = false }: {
  children: ReactNode;
  href: string;
  onNavigate: () => void;
  disabled?: boolean;
  className?: string;
  plain?: boolean;
}) {
  return <a href={href} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
    className={plain ? className : buttonVariants({ variant: 'outline', className })}
    onClick={event => { event.preventDefault(); if (!disabled) onNavigate(); }}>{children}</a>;
}
