import React from 'react';
import { cn } from '../lib/utils';
import { consoleFormLabelClass, consoleInputClass } from '../lib/consoleTokens';

const Input = React.forwardRef(function Input({ className, type = 'text', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(consoleInputClass, className)}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(consoleInputClass, 'resize-y min-h-[2.5rem]', className)}
      {...props}
    />
  );
});

export function FormLabel({ children, className, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className={cn(consoleFormLabelClass, className)}>
      {children}
    </label>
  );
}

export default Input;
