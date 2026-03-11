import { NextResponse } from 'next/server';
import { EditorAgent } from '@/lib/agents';
import { astEngine } from '@/lib/ast/engine';

export async function POST(req: Request) {
  try {
    const { prompt, currentCode, targetFile, intent } = await req.json();

    if (!targetFile || !currentCode) {
       return NextResponse.json({ error: 'Missing targetFile or currentCode' }, { status: 400 });
    }

    await astEngine.init();

    // 1. Run determinisic JSON Agent
    const patch = await EditorAgent.generatePatch(
        targetFile,
        currentCode,
        prompt
    );

    // 2. Safely apply AST patches deterministically
    const newFileContent = astEngine.applyPatch(currentCode, patch);

    // 3. Format into Bolt <orbitArtifact> seamlessly for the streaming parser
    const simulatedStreamResponse = `
<orbitArtifact id="ast-surgical-edit" title="AST Surgical Edits">
  <orbitAction type="file" path="${targetFile}">
${newFileContent}
  </orbitAction>
</orbitArtifact>
    `;

    // To mimic the generateAppStream SSE format:
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            // Send chunk 1
            const chunk = JSON.stringify({ choices: [{ delta: { content: simulatedStreamResponse } }] });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });

  } catch (err: any) {
    console.error('[API edit-ast] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
