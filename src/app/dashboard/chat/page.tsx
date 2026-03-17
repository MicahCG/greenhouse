import { ChatInterface } from '@/components/dashboard/chat-interface';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

interface PageProps {
  searchParams: Promise<{ prompt?: string }>;
}

export default async function ChatPage({ searchParams }: PageProps) {
  const { prompt } = await searchParams;

  // Fetch active projects for the project selector
  const activeProjects = await db.select().from(projects);
  const defaultProjectId = activeProjects[0]?.id;

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Growth Expert</h1>
          <p className="text-zinc-500 text-sm mt-1">
            AI-powered experiment analysis and optimization
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 border border-white/10 rounded-xl overflow-hidden">
        <ChatInterface
          projectId={defaultProjectId}
          initialPrompt={prompt}
        />
      </div>
    </div>
  );
}
