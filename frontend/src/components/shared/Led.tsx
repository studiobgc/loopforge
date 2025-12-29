/**
 * Led - Hardware-style LED indicator
 */

import React from 'react';

interface LedProps {
  on?: boolean;
  color?: 'green' | 'amber' | 'red' | 'blue';
  size?: 'sm' | 'md';
  className?: string;
}

export const Led: React.FC<LedProps> = ({ 
  on = false, 
  color = 'green',
  size = 'md',
  className = ''
}) => (
  <div 
    className={`ba-led ${color} ${size} ${className}`} 
    data-on={on}
    aria-hidden="true"
  />
);
