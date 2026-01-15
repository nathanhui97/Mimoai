/**
 * Skills Library Component
 *
 * Displays and manages the skill library.
 * Allows viewing, searching, editing, and deleting skills.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { SkillSummary, SkillDefinition } from '../types/skill';
import { SkillStorage } from '../lib/skill-storage';
import { SkillCard } from './SkillCard';

interface SkillsLibraryProps {
  onClose: () => void;
  onTestSkill?: (skill: SkillDefinition) => void;
}

export function SkillsLibrary({ onClose, onTestSkill }: SkillsLibraryProps) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillFull, setSelectedSkillFull] =
    useState<SkillDefinition | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Load skills on mount
  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const summaries = await SkillStorage.getSkillSummaries();
      setSkills(summaries);
    } catch (error) {
      console.error('[SkillsLibrary] Failed to load skills:', error);
    }
    setLoading(false);
  };

  // Load full skill when selected
  useEffect(() => {
    if (selectedSkillId) {
      SkillStorage.loadSkill(selectedSkillId).then(skill => {
        setSelectedSkillFull(skill);
      });
    } else {
      setSelectedSkillFull(null);
    }
  }, [selectedSkillId]);

  // Filter skills by search query
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      skill =>
        skill.name.toLowerCase().includes(query) ||
        skill.verb.toLowerCase().includes(query) ||
        skill.object.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    );
  }, [skills, searchQuery]);

  // Handle delete
  const handleDelete = useCallback(
    async (id: string) => {
      if (deleteConfirm !== id) {
        setDeleteConfirm(id);
        return;
      }

      await SkillStorage.deleteSkill(id);
      setDeleteConfirm(null);
      if (selectedSkillId === id) {
        setSelectedSkillId(null);
      }
      await loadSkills();
    },
    [deleteConfirm, selectedSkillId]
  );

  // Handle test
  const handleTest = useCallback(async () => {
    if (!selectedSkillFull || !onTestSkill) return;
    onTestSkill(selectedSkillFull);
  }, [selectedSkillFull, onTestSkill]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl border border-border/60 shadow-soft-xl w-full max-w-3xl max-h-[90vh] overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Skills Library
            </h2>
            <p className="text-sm text-muted-foreground">
              {skills.length} skills extracted from your recordings
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border/60">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Skills list */}
          <div className="w-1/2 border-r border-border/60 overflow-y-auto p-4 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-center py-8">
                <svg
                  className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? 'No skills match your search'
                    : 'No skills extracted yet'}
                </p>
                {!searchQuery && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Record a workflow and click "Extract Skills" to get started
                  </p>
                )}
              </div>
            ) : (
              filteredSkills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  compact
                  isSelected={skill.id === selectedSkillId}
                  onSelect={() => setSelectedSkillId(skill.id)}
                />
              ))
            )}
          </div>

          {/* Skill detail */}
          <div className="w-1/2 overflow-y-auto p-4">
            {selectedSkillFull ? (
              <div className="space-y-4">
                {/* Header */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedSkillFull.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSkillFull.description}
                  </p>
                </div>

                {/* Canonical action */}
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">
                    Canonical Action:
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {selectedSkillFull.canonicalAction.verb}{' '}
                    {selectedSkillFull.canonicalAction.object}
                  </p>
                  {(selectedSkillFull.canonicalAction.verbSynonyms.length > 0 ||
                    selectedSkillFull.canonicalAction.objectSynonyms.length >
                      0) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Also matches:{' '}
                      {[
                        ...selectedSkillFull.canonicalAction.verbSynonyms,
                        ...selectedSkillFull.canonicalAction.objectSynonyms,
                      ].join(', ')}
                    </p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex gap-4">
                  <div className="flex-1 p-3 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Steps</p>
                    <p className="text-lg font-semibold text-foreground">
                      {selectedSkillFull.steps.length}
                    </p>
                  </div>
                  <div className="flex-1 p-3 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">
                      Variables
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {selectedSkillFull.variables.length}
                    </p>
                  </div>
                </div>

                {/* Flags */}
                <div className="space-y-2">
                  {selectedSkillFull.isRepeatable && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                      <span className="text-green-700 font-bold">↻</span>
                      <span className="text-sm text-green-800">
                        Repeatable
                        {selectedSkillFull.repeatHint &&
                          ` (${selectedSkillFull.repeatHint})`}
                      </span>
                    </div>
                  )}
                  {selectedSkillFull.selectionBehavior && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                      <span className="text-sm text-blue-800">
                        Selection:{' '}
                        {selectedSkillFull.selectionBehavior === 'all'
                          ? 'Select all matches'
                          : selectedSkillFull.selectionBehavior === 'first'
                          ? 'Select first match'
                          : 'Ask user'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Variables */}
                {selectedSkillFull.variables.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">
                      Variables:
                    </p>
                    <div className="space-y-1">
                      {selectedSkillFull.variables.map((v, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 rounded-lg bg-muted/30 text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {v.fieldName}
                          </span>
                          {v.defaultValue && (
                            <span className="text-muted-foreground">
                              {' '}
                              = "{v.defaultValue}"
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dependencies */}
                {(selectedSkillFull.dependencies.requires.length > 0 ||
                  selectedSkillFull.dependencies.enables.length > 0) && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">
                      Dependencies:
                    </p>
                    <div className="text-xs text-muted-foreground">
                      <p>
                        Position:{' '}
                        <span className="font-medium">
                          {selectedSkillFull.dependencies.position}
                        </span>
                      </p>
                      {selectedSkillFull.dependencies.requires.length > 0 && (
                        <p>
                          Requires:{' '}
                          {selectedSkillFull.dependencies.requires.length} skills
                        </p>
                      )}
                      {selectedSkillFull.dependencies.enables.length > 0 && (
                        <p>
                          Enables:{' '}
                          {selectedSkillFull.dependencies.enables.length} skills
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Source info */}
                <div className="pt-3 border-t border-border/60">
                  <p className="text-xs text-muted-foreground">
                    From: {selectedSkillFull.sourceWorkflowName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Extracted:{' '}
                    {new Date(selectedSkillFull.extractedAt).toLocaleString()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {onTestSkill && (
                    <button
                      onClick={handleTest}
                      className="flex-1 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-colors"
                    >
                      Test Skill
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selectedSkillFull.id)}
                    className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                      deleteConfirm === selectedSkillFull.id
                        ? 'bg-red-600 text-white'
                        : 'text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {deleteConfirm === selectedSkillFull.id
                      ? 'Confirm Delete'
                      : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Select a skill to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
