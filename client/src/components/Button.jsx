import React from 'react';
import { buttonClass } from '../lib/buttonStyles';
import { cn } from '../lib/utils';

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(buttonClass(variant, size), className)}
      {...props}
    />
  );
}
