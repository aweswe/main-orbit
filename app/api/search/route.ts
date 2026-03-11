import { NextResponse } from 'next/server';

/**
 * Roadmap Item 6: Context Graph Caching
 * -------------------------------------
 * This API endpoint simulates a semantic codebase search / RAG pipeline.
 * In a real implementation, this would connect to Pinecone, Qdrant, or 
 * a localized sqlite-vss database to retrieve relevant AST nodes based on 
 * the user's prompt.
 * 
 * For this implementation, it uses a lightweight keyword-based heuristic
 * to return mocked "contextual nodes" for better LLM prompting without
 * blowing up the token window.
 */

interface SearchRequest {
    query: string;
    files: Array<{ path: string; content: string }>;
}

export async function POST(req: Request) {
    try {
        let body: Partial<SearchRequest> = {};
        try {
            body = await req.json();
        } catch(e) { /* ignore */ }
        
        const { query, files = [] } = body;

        if (!query || query.trim() === '') {
            return NextResponse.json({ contextNodes: [] });
        }

        // Extremely simplified "Semantic" Context Graph Caching logic
        // We find files that have high keyword overlap with the user query
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);

        const scoredFiles = files.map(file => {
            let score = 0;
            const lowerContent = file.content.toLowerCase();
            const lowerPath = file.path.toLowerCase();

            for (const term of queryTerms) {
                // High weight for matching file paths/names
                if (lowerPath.includes(term)) score += 10;

                // Lower weight for matching file content
                const matches = lowerContent.split(term).length - 1;
                score += Math.min(matches, 5); // cap at 5 so one word doesn't dominate
            }

            return { path: file.path, score, content: file.content };
        });

        // Sort by relevance and take top 3 contextual files
        const topContext = scoredFiles
            .filter(f => f.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(f => ({
                path: f.path,
                relevanceScore: f.score,
                // In a real RAG graph, we'd only return the specific functions/classes
                // The AI needs. Here we just return the AST signature if possible, or truncate.
                contextSnippet: truncateContext(f.content, 500)
            }));

        return NextResponse.json({ contextNodes: topContext });
    } catch (e: any) {
        console.error('Search API error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

function truncateContext(content: string, maxChars: number) {
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars) + '\n... [Content Truncated by Context Graph]';
}
