import React from 'react';
import { cn } from '../lib/utils';

export default function PageHeader({ title, description, actions, className }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-[#E8EAED] pb-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-[#202124]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-[#5F6368]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="w-full shrink-0 lg:w-auto">{actions}</div> : null}
    </div>
  );
}
