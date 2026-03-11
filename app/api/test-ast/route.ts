import { NextResponse } from 'next/server';
import { EditorAgent } from '@/lib/agents';
import { astEngine } from '@/lib/ast/engine';

export async function GET() {
  await astEngine.init();

  const dummyCode = `
import React from 'react';
export default function App() {
  return <div>Hello</div>;
}  
`;

  try {
    console.log('Sending mock edit request to Editor Agent...');
    const patch = await EditorAgent.generatePatch(
        'App.tsx',
        dummyCode,
        'Change the text "Hello" to say "Orbit AST Engine Active"'
    );

    return NextResponse.json({
        success: true,
        message: 'Editor Agent successfully output structural AST patch instead of raw code.',
        patch
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
