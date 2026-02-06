// @ts-ignore: Deno library
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// @ts-ignore: Deno namespace
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateUIUXPlanRequest {
  requirements: any;
  originalPrompt: string;
  projectPlan?: any;
}

// ============================================
// PREMIUM UI/UX DESIGN SYSTEM PROMPT
// ============================================
const UIUX_SYSTEM_PROMPT = `You are a Senior UI/UX Designer specializing in premium web experiences.
Your designs should WOW users at first glance. Every app you design should feel modern, polished, and premium.

DESIGN PHILOSOPHY:
1. First impressions matter - users should be AMAZED at first glance
2. Use modern design trends: glassmorphism, subtle gradients, micro-animations
3. Dark mode by default with proper WCAG contrast ratios
4. Consistent spacing rhythm (4px/8px grid system)
5. Typography hierarchy with modern fonts (Inter, Outfit, etc.)
6. Every interactive element should have hover/focus states
7. Use color psychology - blue for trust, green for success, etc.

SYSTEM CONSTRAINTS:
- Styling: Tailwind CSS ONLY (no styled-components, Emotion, etc.)
- Animation: Framer Motion + Tailwind Animate
- Icons: Lucide React
- UI Components: shadcn/ui patterns (Radix + Tailwind)
- Charts: Recharts (if needed)

Return ONLY valid JSON with this structure:`;

const UIUX_OUTPUT_SCHEMA = `{
  "appType": "dashboard|form|landing|admin|ecommerce|social|chat|productivity",
  
  "designSystem": {
    "colors": {
      "primary": "#hex - main brand color",
      "primaryForeground": "#hex - text on primary",
      "secondary": "#hex - secondary actions",
      "secondaryForeground": "#hex",
      "accent": "#hex - highlights, CTAs",
      "accentForeground": "#hex",
      "background": "#hex - page background",
      "foreground": "#hex - main text",
      "muted": "#hex - subtle backgrounds",
      "mutedForeground": "#hex - secondary text",
      "card": "#hex - card backgrounds",
      "cardForeground": "#hex",
      "destructive": "#hex - errors, delete",
      "border": "#hex - borders",
      "ring": "#hex - focus rings"
    },
    "typography": {
      "headingFont": "Outfit|Inter|Plus Jakarta Sans",
      "bodyFont": "Inter|DM Sans|Nunito",
      "scale": "1.25|1.333|1.5 - type scale ratio"
    },
    "spacing": "4px|8px - base unit",
    "borderRadius": {
      "sm": "0.25rem",
      "md": "0.5rem", 
      "lg": "0.75rem",
      "xl": "1rem",
      "2xl": "1.5rem",
      "full": "9999px"
    },
    "shadows": {
      "sm": "0 1px 2px rgba(0,0,0,0.05)",
      "md": "0 4px 6px rgba(0,0,0,0.1)",
      "lg": "0 10px 15px rgba(0,0,0,0.1)",
      "glow": "0 0 20px rgba(primary,0.3)"
    }
  },

  "themeMode": "dark|light|system",
  
  "effects": {
    "glassmorphism": true|false,
    "gradients": ["bg-gradient-to-br from-purple-500 to-pink-500", ...],
    "animations": {
      "pageTransition": "fade|slide|scale",
      "hoverScale": "hover:scale-105 transition-transform",
      "buttonPress": "active:scale-95",
      "fadeIn": "animate-in fade-in duration-300"
    }
  },

  "layout": {
    "structure": "sidebar|topnav|split|fullwidth|centered",
    "maxWidth": "max-w-7xl|max-w-6xl|max-w-full",
    "sections": [
      { "name": "section-name", "purpose": "what it contains" }
    ]
  },

  "components": [
    {
      "name": "ComponentName",
      "purpose": "What it does",
      "tailwindClasses": "specific Tailwind classes to use",
      "animation": "Framer Motion animation to apply"
    }
  ],

  "componentStyles": {
    "Button": "inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
    "Card": "rounded-2xl border border-border bg-card p-6 shadow-md",
    "Input": "flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
    "Badge": "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
  },

  "interactions": [
    { "trigger": "user action", "animation": "what animates", "result": "outcome" }
  ]
}`;

const UIUX_GUIDELINES = `
DESIGN PATTERNS BY APP TYPE:

1. **Dashboard**: 
   - Sidebar navigation (collapsible on mobile)
   - Stat cards with hover effects and sparklines
   - Dark theme with accent color highlights
   - Grid layout for charts (Recharts)

2. **Landing Page**:
   - Hero section with gradient background
   - Glassmorphic cards for features
   - Scroll-triggered animations (Framer Motion)
   - Floating navigation with blur backdrop

3. **Form/Admin**:
   - Clean, minimal design
   - Clear visual hierarchy
   - Inline validation with subtle animations
   - Progress indicators for multi-step

4. **E-commerce**:
   - Product cards with hover zoom
   - Quick-view modals
   - Sticky cart summary
   - Trust badges and social proof

5. **Chat/Social**:
   - Real-time feel with typing indicators
   - Avatar presence indicators
   - Message bubbles with timestamps
   - Notification badges with pulse animation

COLOR PALETTE SUGGESTIONS:
- Tech/SaaS: Deep blues (#0f172a) + Electric accents (#3b82f6, #8b5cf6)
- Finance: Navy (#1e3a5f) + Gold accents (#f59e0b)
- Health: Teal (#0d9488) + Soft backgrounds (#f0fdfa)
- Creative: Vibrant gradients (purple→pink, blue→cyan)
- Minimal: Pure blacks/whites + single accent

MUST INCLUDE ANIMATIONS:
- Page load: Staggered fade-in for content
- Hover: Scale or color shift on buttons/cards
- Click: Press effect (scale down slightly)
- Transitions: Smooth between states
`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { requirements, originalPrompt, projectPlan } = await req.json() as GenerateUIUXPlanRequest;

    console.log('[generate-uiux-plan] Starting premium UI/UX design...');
    console.log('[generate-uiux-plan] Prompt:', originalPrompt?.substring(0, 100) + '...');

    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY not configured');
    }

    // Build comprehensive prompt
    const userPrompt = `
ORIGINAL USER REQUEST: "${originalPrompt}"

${requirements ? `CLARIFIED REQUIREMENTS:\n${JSON.stringify(requirements, null, 2)}` : ''}

${projectPlan ? `PROJECT STRUCTURE (from planner):\n${JSON.stringify(projectPlan.sharedProject || projectPlan, null, 2)}` : ''}

Create a PREMIUM, HIGH-QUALITY UI/UX design plan.
The design should feel modern, polished, and professional.
Users should be IMPRESSED at first glance.

${UIUX_OUTPUT_SCHEMA}

${UIUX_GUIDELINES}

Remember: Return ONLY valid JSON. No markdown, no explanation.
`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: UIUX_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4, // Slightly creative but consistent
        max_tokens: 4000, // Increased for detailed design system
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[generate-uiux-plan] Groq API error:', response.status, errorText);
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    let uiuxPlan;
    try {
      uiuxPlan = JSON.parse(content);
    } catch (e) {
      console.error('[generate-uiux-plan] Failed to parse JSON:', content.substring(0, 500));
      throw new Error('Invalid JSON response from AI');
    }

    // Validate required fields
    if (!uiuxPlan.designSystem || !uiuxPlan.layout) {
      console.warn('[generate-uiux-plan] Missing required fields, adding defaults');
      uiuxPlan.designSystem = uiuxPlan.designSystem || getDefaultDesignSystem();
      uiuxPlan.layout = uiuxPlan.layout || { structure: 'fullwidth', sections: [] };
    }

    console.log('[generate-uiux-plan] ✅ Success! Design system generated.');
    console.log('[generate-uiux-plan] Theme:', uiuxPlan.themeMode, '| Style:', uiuxPlan.designSystem?.colors?.primary);

    return new Response(JSON.stringify({
      success: true,
      uiuxPlan
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[generate-uiux-plan] Error:', error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        // Return a safe default so pipeline doesn't break
        uiuxPlan: getDefaultDesignSystem()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Default design system fallback
function getDefaultDesignSystem() {
  return {
    appType: 'app',
    designSystem: {
      colors: {
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#64748b',
        secondaryForeground: '#ffffff',
        accent: '#8b5cf6',
        accentForeground: '#ffffff',
        background: '#0f172a',
        foreground: '#f8fafc',
        muted: '#1e293b',
        mutedForeground: '#94a3b8',
        card: '#1e293b',
        cardForeground: '#f8fafc',
        destructive: '#ef4444',
        border: '#334155',
        ring: '#3b82f6'
      },
      typography: {
        headingFont: 'Inter',
        bodyFont: 'Inter',
        scale: '1.25'
      },
      spacing: '8px',
      borderRadius: {
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.5rem',
        full: '9999px'
      }
    },
    themeMode: 'dark',
    effects: {
      glassmorphism: false,
      gradients: [],
      animations: {
        hoverScale: 'hover:scale-105 transition-transform',
        fadeIn: 'animate-in fade-in duration-300'
      }
    },
    layout: {
      structure: 'fullwidth',
      maxWidth: 'max-w-6xl',
      sections: []
    },
    components: [],
    componentStyles: {
      Button: 'inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90',
      Card: 'rounded-xl border border-border bg-card p-4',
      Input: 'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
    }
  };
}
