/**
 * Supabase Edge Function: skill_library
 * Manages user-taught skills for the AI orchestrator
 * Stores skills in Supabase for cloud persistence and cross-device sync
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface SkillLibraryRequest {
  action: 'save' | 'list' | 'get' | 'delete' | 'update_execution';
  skill?: Record<string, unknown>;
  skillId?: string;
  success?: boolean;
  example?: {
    userRequest: string;
    variableValues: Record<string, string>;
    success: boolean;
    timestamp: number;
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    const payload: SkillLibraryRequest = await req.json();

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from JWT (optional - for multi-user support)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (payload.action) {
      case 'save': {
        if (!payload.skill) {
          throw new Error('Skill data is required for save action');
        }

        const skill = payload.skill;
        const skillId = skill.id as string;

        // Upsert skill into database
        const { error } = await supabase
          .from('skills')
          .upsert({
            id: skillId,
            user_id: userId,
            name: skill.name,
            description: skill.description,
            usage_context: skill.usage_context,
            steps: skill.steps,
            variables: skill.variables,
            synonyms: skill.synonyms,
            required_context: skill.required_context,
            prerequisites: skill.prerequisites,
            provides: skill.provides,
            created_at: skill.created_at ? new Date(skill.created_at as number).toISOString() : new Date().toISOString(),
            last_used: skill.last_used ? new Date(skill.last_used as number).toISOString() : null,
            success_count: skill.success_count ?? 0,
            failure_count: skill.failure_count ?? 0,
            examples: skill.examples ?? [],
          }, {
            onConflict: 'id',
          });

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        return jsonResponse({ success: true, skillId });
      }

      case 'list': {
        // Build query
        let query = supabase
          .from('skills')
          .select('*')
          .order('last_used', { ascending: false, nullsFirst: false });

        // Filter by user if authenticated
        if (userId) {
          query = query.eq('user_id', userId);
        }

        const { data: skills, error } = await query;

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        // Transform to client format
        const transformedSkills = (skills || []).map(transformSkillToClient);

        return jsonResponse({ success: true, skills: transformedSkills });
      }

      case 'get': {
        if (!payload.skillId) {
          throw new Error('skillId is required for get action');
        }

        const { data: skill, error } = await supabase
          .from('skills')
          .select('*')
          .eq('id', payload.skillId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return jsonResponse({ success: false, error: 'Skill not found' }, 404);
          }
          throw new Error(`Database error: ${error.message}`);
        }

        return jsonResponse({ success: true, skill: transformSkillToClient(skill) });
      }

      case 'delete': {
        if (!payload.skillId) {
          throw new Error('skillId is required for delete action');
        }

        const { error } = await supabase
          .from('skills')
          .delete()
          .eq('id', payload.skillId);

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        return jsonResponse({ success: true });
      }

      case 'update_execution': {
        if (!payload.skillId) {
          throw new Error('skillId is required for update_execution action');
        }

        // Get current skill
        const { data: skill, error: fetchError } = await supabase
          .from('skills')
          .select('success_count, failure_count, examples')
          .eq('id', payload.skillId)
          .single();

        if (fetchError) {
          throw new Error(`Database error: ${fetchError.message}`);
        }

        // Update counts and examples
        const updates: Record<string, unknown> = {
          last_used: new Date().toISOString(),
        };

        if (payload.success === true) {
          updates.success_count = (skill.success_count || 0) + 1;
        } else if (payload.success === false) {
          updates.failure_count = (skill.failure_count || 0) + 1;
        }

        if (payload.example) {
          // Keep last 20 examples
          const examples = [...(skill.examples || []), payload.example].slice(-20);
          updates.examples = examples;
        }

        const { error: updateError } = await supabase
          .from('skills')
          .update(updates)
          .eq('id', payload.skillId);

        if (updateError) {
          throw new Error(`Database error: ${updateError.message}`);
        }

        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${payload.action}` }, 400);
    }
  } catch (error) {
    console.error('Error in skill_library:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * Transform database skill to client format
 */
function transformSkillToClient(dbSkill: Record<string, unknown>): Record<string, unknown> {
  return {
    id: dbSkill.id,
    name: dbSkill.name,
    description: dbSkill.description || '',
    usage_context: dbSkill.usage_context || '',
    steps: dbSkill.steps || [],
    variables: dbSkill.variables || [],
    synonyms: dbSkill.synonyms || [],
    required_context: dbSkill.required_context || [],
    prerequisites: dbSkill.prerequisites || [],
    provides: dbSkill.provides || [],
    user_id: dbSkill.user_id,
    created_at: dbSkill.created_at ? new Date(dbSkill.created_at as string).getTime() : Date.now(),
    last_used: dbSkill.last_used ? new Date(dbSkill.last_used as string).getTime() : null,
    success_count: dbSkill.success_count || 0,
    failure_count: dbSkill.failure_count || 0,
    examples: dbSkill.examples || [],
  };
}

/**
 * Create JSON response with CORS headers
 */
function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
