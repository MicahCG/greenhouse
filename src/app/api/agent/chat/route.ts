import { auth } from '@clerk/nextjs/server';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { AGENT_TOOLS, executeToolCall } from '@/lib/agent/tools';
import { db } from '@/lib/db';
import { projects, verticals, variants, agent_changes } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  systemPrompt: string,
  messages: AnthropicMessage[]
): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  return response.json() as Promise<AnthropicResponse>;
}

export async function POST(request: Request) {
  try {
  // Auth check
  const { userId } = await auth();
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }

  let body: { messages: AnthropicMessage[]; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { messages, projectId } = body;

  // Validate messages
  if (!Array.isArray(messages)) {
    return errorResponse('messages must be an array', 400);
  }

  // Build context for system prompt
  let contextProjects: Array<{
    id: string;
    name: string;
    funnel_focus: string;
    status: string;
    verticals: Array<{
      id: string;
      name: string;
      slug: string;
      variantCount: number;
      visitors: number;
      convRate: number;
      variants: Array<{
        id: string;
        slug: string;
        version: number;
        status: string;
        traffic_weight: number;
        config: unknown;
      }>;
    }>;
  }> = [];

  let recentChanges: Array<{
    hypothesis: string;
    change_type: string;
    verdict: string;
    implemented_at: Date;
  }> = [];

  try {
    const allProjects = await db.select().from(projects);
    contextProjects = await Promise.all(
      allProjects.map(async (p) => {
        const allVerticals = await db
          .select()
          .from(verticals)
          .where(eq(verticals.project_id, p.id));

        const verticalSummaries = await Promise.all(
          allVerticals.map(async (v) => {
            const allVariants = await db
              .select()
              .from(variants)
              .where(eq(variants.vertical_id, v.id));
            return {
              id: v.id,
              name: v.name,
              slug: v.slug,
              variantCount: allVariants.length,
              visitors: 0,
              convRate: 0,
              variants: allVariants.map((va) => ({
                id: va.id,
                slug: va.slug,
                version: va.version,
                status: va.status,
                traffic_weight: va.traffic_weight,
                config: va.config,
                is_control: va.is_control,
                source_file: va.source_file,
              })),
            };
          })
        );

        return {
          id: p.id,
          name: p.name,
          funnel_focus: p.funnel_focus,
          status: p.status,
          verticals: verticalSummaries,
        };
      })
    );

    // Filter to specific project if given
    if (projectId) {
      contextProjects = contextProjects.filter((p) => p.id === projectId);
    }

    const rawChanges = await db
      .select()
      .from(agent_changes)
      .orderBy(desc(agent_changes.implemented_at))
      .limit(10);

    recentChanges = rawChanges.map((c) => ({
      hypothesis: c.hypothesis,
      change_type: c.change_type,
      verdict: c.verdict,
      implemented_at: c.implemented_at,
    }));
  } catch (err) {
    console.warn('[agent/chat] Failed to build context:', err);
  }

  const systemPrompt = buildSystemPrompt({
    projects: contextProjects,
    recentChanges,
  });

  // Create a streaming response via ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Record<string, unknown>) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      }

      try {
        let loopMessages: AnthropicMessage[] = [...messages];

        // Agentic loop
        while (true) {
          const response = await callAnthropic(systemPrompt, loopMessages);

          if (response.stop_reason === 'end_turn') {
            // Stream the final text response word by word
            const textBlock = response.content.find((b) => b.type === 'text');
            if (textBlock && textBlock.text) {
              const words = textBlock.text.split(' ');
              for (const word of words) {
                emit({ type: 'text', content: word + ' ' });
              }
            }
            emit({ type: 'done' });
            break;
          }

          if (response.stop_reason === 'tool_use') {
            // Add assistant message with tool calls
            loopMessages.push({
              role: 'assistant',
              content: response.content,
            });

            // Execute each tool call
            const toolResults: AnthropicContentBlock[] = [];
            for (const block of response.content) {
              if (block.type === 'tool_use' && block.name && block.id) {
                emit({ type: 'tool_call', tool: block.name, input: block.input ?? {} });
                const result = await executeToolCall(
                  block.name,
                  (block.input ?? {}) as Record<string, unknown>
                );
                emit({ type: 'tool_result', tool: block.name, result });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result,
                });
              }
            }

            loopMessages.push({ role: 'user', content: toolResults });
            continue;
          }

          // Unexpected stop reason — emit done and exit
          emit({ type: 'done' });
          break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent/chat] Unhandled route error:', err);
    return errorResponse(`Internal error: ${message}`, 500);
  }
}
