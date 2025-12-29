/**
 * ShortcutsOverlay - Keyboard shortcuts help overlay
 */

import React from 'react';
import { X } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../../design/constants';

interface ShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsOverlay: React.FC<ShortcutsOverlayProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const sections = [
    {
      title: 'Transport',
      shortcuts: [
        KEYBOARD_SHORTCUTS.play,
        KEYBOARD_SHORTCUTS.stop,
        KEYBOARD_SHORTCUTS.rewind,
      ],
    },
    {
      title: 'Pads (Top Row)',
      shortcuts: [
        KEYBOARD_SHORTCUTS.pad1,
        KEYBOARD_SHORTCUTS.pad2,
        KEYBOARD_SHORTCUTS.pad3,
        KEYBOARD_SHORTCUTS.pad4,
        KEYBOARD_SHORTCUTS.pad5,
        KEYBOARD_SHORTCUTS.pad6,
        KEYBOARD_SHORTCUTS.pad7,
        KEYBOARD_SHORTCUTS.pad8,
      ],
    },
    {
      title: 'Pads (Bottom Row)',
      shortcuts: [
        KEYBOARD_SHORTCUTS.pad9,
        KEYBOARD_SHORTCUTS.pad10,
        KEYBOARD_SHORTCUTS.pad11,
        KEYBOARD_SHORTCUTS.pad12,
        KEYBOARD_SHORTCUTS.pad13,
        KEYBOARD_SHORTCUTS.pad14,
        KEYBOARD_SHORTCUTS.pad15,
        KEYBOARD_SHORTCUTS.pad16,
      ],
    },
    {
      title: 'Actions',
      shortcuts: [
        KEYBOARD_SHORTCUTS.undo,
        KEYBOARD_SHORTCUTS.redo,
        KEYBOARD_SHORTCUTS.save,
        KEYBOARD_SHORTCUTS.open,
        KEYBOARD_SHORTCUTS.export,
        KEYBOARD_SHORTCUTS.help,
      ],
    },
  ];

  return (
    <div className="ba-overlay-backdrop" onClick={onClose}>
      <div className="ba-shortcuts-overlay" onClick={e => e.stopPropagation()}>
        <div className="ba-shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="ba-btn-icon-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="ba-shortcuts-content">
          {sections.map(section => (
            <div key={section.title} className="ba-shortcuts-section">
              <h3>{section.title}</h3>
              <div className="ba-shortcuts-grid">
                {section.shortcuts.map((shortcut, i) => (
                  <div key={i} className="ba-shortcut-item">
                    <kbd>{shortcut.label}</kbd>
                    <span>{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="ba-shortcuts-footer">
          Press <kbd>?</kbd> to toggle this overlay
        </div>
      </div>
    </div>
  );
};
