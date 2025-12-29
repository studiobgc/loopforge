/**
 * ToolStrip - Collapsed toolbar with expandable sections
 */

import React, { useState } from 'react';
import { ChevronDown, Volume2 } from 'lucide-react';
import { Led } from '../shared';

interface ToolStripSectionProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const ToolStripSection: React.FC<ToolStripSectionProps> = ({
  label, icon, badge, expanded, onToggle, children
}) => (
  <div className={`ba-toolstrip-section ${expanded ? 'expanded' : ''}`}>
    <button className="ba-toolstrip-toggle" onClick={onToggle}>
      {icon}
      <span>{label}</span>
      {badge !== undefined && <span className="ba-toolstrip-badge">{badge}</span>}
      <ChevronDown size={12} className={`ba-toolstrip-chevron ${expanded ? 'open' : ''}`} />
    </button>
    {expanded && (
      <div className="ba-toolstrip-content">
        {children}
      </div>
    )}
  </div>
);

interface ToolStripProps {
  sections: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    badge?: string | number;
    content: React.ReactNode;
  }>;
  volume: number;
  onVolumeChange: (volume: number) => void;
  isConnected: boolean;
}

export const ToolStrip: React.FC<ToolStripProps> = ({
  sections,
  volume,
  onVolumeChange,
  isConnected,
}) => {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setExpandedSection(prev => prev === id ? null : id);
  };

  return (
    <footer className="ba-forge-toolstrip">
      <div className="ba-toolstrip-row">
        {sections.map(section => (
          <ToolStripSection
            key={section.id}
            id={section.id}
            label={section.label}
            icon={section.icon}
            badge={section.badge}
            expanded={expandedSection === section.id}
            onToggle={() => toggleSection(section.id)}
          >
            {section.content}
          </ToolStripSection>
        ))}

        <div className="ba-toolstrip-spacer" />

        {/* Master Volume */}
        <div className="ba-master-inline">
          <Volume2 size={14} />
          <input
            type="range"
            min={0}
            max={100}
            value={volume * 100}
            onChange={e => onVolumeChange(Number(e.target.value) / 100)}
            className="ba-volume-slider"
            aria-label="Master volume"
          />
        </div>

        {/* Status */}
        <div className="ba-status-inline">
          <Led on={isConnected} color="green" />
          <span>{isConnected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>
    </footer>
  );
};
