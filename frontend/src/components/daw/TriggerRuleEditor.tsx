/**
 * TriggerRuleEditor - Autechre-style conditional rule builder
 * 
 * "We may have one fader that determines how often a snare does a little roll or skip,
 * and another thing that listens and says 'If that snare plays that roll three times,
 * then I'll do this.'" - Sean Booth
 * 
 * Features:
 * - Visual rule builder with conditions and actions
 * - Probability sliders for each rule
 * - Real-time enable/disable
 * - Rule chaining visualization
 */

import React, { useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Zap,
  ArrowRight,
  Shuffle,
  RotateCcw,
  VolumeX,
  Volume2,
  SkipForward,
  Copy,
  RefreshCw,
} from 'lucide-react';

interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  probability: number;
  enabled: boolean;
}

interface TriggerRuleEditorProps {
  rules: TriggerRule[];
  onAddRule: (rule: TriggerRule) => void;
  onUpdateRule: (id: string, updates: Partial<TriggerRule>) => void;
  onRemoveRule: (id: string) => void;
  className?: string;
}

const CONDITIONS = [
  { value: 'consecutive_plays > 2', label: 'Same slice 3x in a row', icon: Copy },
  { value: 'consecutive_plays > 3', label: 'Same slice 4x in a row', icon: Copy },
  { value: 'total_plays % 4', label: 'Every 4th trigger', icon: RefreshCw },
  { value: 'total_plays % 8', label: 'Every 8th trigger', icon: RefreshCw },
  { value: 'slice_index == 0', label: 'First slice plays', icon: Zap },
  { value: 'velocity > 0.8', label: 'High velocity hit', icon: Volume2 },
  { value: 'time_since_last > 4', label: '4+ beats since last', icon: SkipForward },
];

const ACTIONS = [
  { value: 'skip_next', label: 'Skip next trigger', icon: SkipForward },
  { value: 'double_trigger', label: 'Double trigger', icon: Copy },
  { value: 'pitch_up_12', label: 'Pitch up octave', icon: ChevronRight },
  { value: 'pitch_down_12', label: 'Pitch down octave', icon: ChevronDown },
  { value: 'pitch_up_7', label: 'Pitch up fifth', icon: ChevronRight },
  { value: 'reverse', label: 'Play reversed', icon: RefreshCw },
  { value: 'random_slice', label: 'Random slice', icon: Shuffle },
  { value: 'half_velocity', label: 'Half velocity', icon: VolumeX },
  { value: 'double_velocity', label: 'Double velocity', icon: Volume2 },
  { value: 'reset_sequence', label: 'Reset to start', icon: RotateCcw },
];

export const TriggerRuleEditor: React.FC<TriggerRuleEditorProps> = ({
  rules,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  className = '',
}) => {
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [newRuleCondition, setNewRuleCondition] = useState(CONDITIONS[0].value);
  const [newRuleAction, setNewRuleAction] = useState(ACTIONS[0].value);
  
  const toggleExpanded = (id: string) => {
    setExpandedRules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  const handleAddRule = useCallback(() => {
    const conditionLabel = CONDITIONS.find(c => c.value === newRuleCondition)?.label || newRuleCondition;
    const actionLabel = ACTIONS.find(a => a.value === newRuleAction)?.label || newRuleAction;
    
    const rule: TriggerRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `${conditionLabel} → ${actionLabel}`,
      condition: newRuleCondition,
      action: newRuleAction,
      probability: 1.0,
      enabled: true,
    };
    
    onAddRule(rule);
    setExpandedRules(prev => new Set(prev).add(rule.id));
  }, [newRuleCondition, newRuleAction, onAddRule]);
  
  const getConditionInfo = (condition: string) => 
    CONDITIONS.find(c => c.value === condition) || { label: condition, icon: Zap };
  
  const getActionInfo = (action: string) => 
    ACTIONS.find(a => a.value === action) || { label: action, icon: ArrowRight };
  
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-wide uppercase">
          Trigger Rules
        </h3>
        <span className="text-xs text-zinc-500">
          {rules.filter(r => r.enabled).length}/{rules.length} active
        </span>
      </div>
      
      {/* Rule list */}
      <div className="flex flex-col gap-2">
        {rules.map((rule) => {
          const isExpanded = expandedRules.has(rule.id);
          const ConditionIcon = getConditionInfo(rule.condition).icon;
          const ActionIcon = getActionInfo(rule.action).icon;
          
          return (
            <div
              key={rule.id}
              className={`rounded-lg border transition-all ${
                rule.enabled 
                  ? 'bg-zinc-900/80 border-zinc-700' 
                  : 'bg-zinc-900/40 border-zinc-800 opacity-60'
              }`}
            >
              {/* Rule header */}
              <div 
                className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                onClick={() => toggleExpanded(rule.id)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateRule(rule.id, { enabled: !rule.enabled });
                  }}
                  className={`w-8 h-4 rounded-full transition-colors ${
                    rule.enabled ? 'bg-green-600' : 'bg-zinc-700'
                  }`}
                >
                  <div 
                    className={`w-3 h-3 rounded-full bg-white transition-transform ${
                      rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <ConditionIcon className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-xs text-zinc-400 truncate">
                    {getConditionInfo(rule.condition).label}
                  </span>
                  <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" />
                  <ActionIcon className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-xs text-zinc-400 truncate">
                    {getActionInfo(rule.action).label}
                  </span>
                </div>
                
                {/* Probability indicator */}
                <div className="flex items-center gap-1">
                  <div className="w-12 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                      style={{ width: `${rule.probability * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 w-8 text-right">
                    {Math.round(rule.probability * 100)}%
                  </span>
                </div>
                
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                )}
              </div>
              
              {/* Expanded content */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-zinc-800">
                  {/* Probability slider */}
                  <div className="flex items-center gap-3 py-3">
                    <label className="text-xs text-zinc-500 w-20">Probability</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={rule.probability}
                      onChange={(e) => onUpdateRule(rule.id, { probability: parseFloat(e.target.value) })}
                      className="flex-1 h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none
                        [&::-webkit-slider-thumb]:w-4
                        [&::-webkit-slider-thumb]:h-4
                        [&::-webkit-slider-thumb]:rounded-full
                        [&::-webkit-slider-thumb]:bg-gradient-to-r
                        [&::-webkit-slider-thumb]:from-blue-500
                        [&::-webkit-slider-thumb]:to-purple-500
                        [&::-webkit-slider-thumb]:shadow-lg"
                    />
                    <span className="text-sm text-white font-mono w-12 text-right">
                      {Math.round(rule.probability * 100)}%
                    </span>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => onRemoveRule(rule.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        
        {rules.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No rules yet. Add a rule to start building generative sequences.
          </div>
        )}
      </div>
      
      {/* Add new rule */}
      <div className="p-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30">
        <div className="text-xs text-zinc-500 mb-3">Add New Rule</div>
        
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] text-zinc-600 uppercase">If</span>
          <select
            value={newRuleCondition}
            onChange={(e) => setNewRuleCondition(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-blue-500"
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] text-zinc-600 uppercase">Then</span>
          <select
            value={newRuleAction}
            onChange={(e) => setNewRuleAction(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-blue-500"
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        
        <button
          onClick={handleAddRule}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-lg text-sm font-medium text-white transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>
      
      {/* Info */}
      <p className="text-[10px] text-zinc-600 italic">
        Rules are evaluated in order. Multiple rules can fire on the same trigger.
        Probability controls how often a rule activates when its condition is met.
      </p>
    </div>
  );
};

export default TriggerRuleEditor;
