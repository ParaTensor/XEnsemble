import React from 'react';
import { cn } from '../lib/utils';
import { consoleInputClass } from '../lib/consoleTokens';

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

export default Input;
