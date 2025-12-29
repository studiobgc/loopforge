/**
 * LcdDisplay - LCD-style numeric/text display
 */

import React from 'react';

interface LcdDisplayProps {
  value: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LcdDisplay: React.FC<LcdDisplayProps> = ({ 
  value, 
  label,
  size = 'md',
  className = ''
}) => (
  <div className={`ba-lcd ba-lcd-${size} ${className}`}>
    {label && <div className="ba-lcd-label">{label}</div>}
    <div className="ba-lcd-value">{value}</div>
  </div>
);
