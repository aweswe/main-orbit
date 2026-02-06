/**
 * SYSTEM CONSTRAINTS
 * ===================
 * Defines all supported libraries, patterns, and their equivalents.
 * When users request unsupported libraries, we map them to supported alternatives.
 * 
 * This enables "10 million possibilities" within a controlled, high-quality system.
 */

// ============================================
// UI COMPONENT LIBRARIES
// ============================================
export const UI_LIBRARIES = {
    supported: {
        'shadcn': {
            name: 'shadcn/ui',
            packages: ['@radix-ui/react-slot', 'class-variance-authority', 'clsx', 'tailwind-merge'],
            styleSystem: 'tailwind',
            description: 'Radix primitives + Tailwind CSS (default, recommended)'
        },
        'radix': {
            name: 'Radix UI',
            packages: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tooltip'],
            styleSystem: 'tailwind',
            description: 'Headless primitives for custom styling'
        }
    },

    // Unsupported libraries → map to shadcn equivalent
    conversions: {
        '@mui/material': 'shadcn',
        '@material-ui/core': 'shadcn',
        '@chakra-ui/react': 'shadcn',
        'antd': 'shadcn',
        'ant-design': 'shadcn',
        'bootstrap': 'shadcn',
        'react-bootstrap': 'shadcn',
        'semantic-ui-react': 'shadcn',
        'primereact': 'shadcn',
        'mantine': 'shadcn',
        '@nextui-org/react': 'shadcn',
        'evergreen-ui': 'shadcn',
        'grommet': 'shadcn',
        'rebass': 'shadcn'
    }
} as const;

// ============================================
// ANIMATION LIBRARIES
// ============================================
export const ANIMATION_LIBRARIES = {
    supported: {
        'framer-motion': {
            name: 'Framer Motion',
            packages: ['framer-motion'],
            description: 'Primary animation library - declarative, powerful, React-native'
        },
        'tailwind-animate': {
            name: 'Tailwind Animate',
            packages: ['tailwindcss-animate'],
            description: 'CSS-only animations via Tailwind classes'
        }
    },

    conversions: {
        'react-spring': 'framer-motion',
        '@react-spring/web': 'framer-motion',
        'gsap': 'framer-motion',
        'anime.js': 'framer-motion',
        'animejs': 'framer-motion',
        'react-transition-group': 'framer-motion',
        'react-motion': 'framer-motion',
        'velocity-react': 'framer-motion',
        'popmotion': 'framer-motion',
        'lottie-react': 'framer-motion', // Can still use Lottie with Framer
        '@lottiefiles/react-lottie-player': 'framer-motion'
    }
} as const;

// ============================================
// ICON LIBRARIES
// ============================================
export const ICON_LIBRARIES = {
    supported: {
        'lucide-react': {
            name: 'Lucide React',
            packages: ['lucide-react'],
            description: 'Primary icon library - clean, consistent, tree-shakeable'
        }
    },

    conversions: {
        'react-icons': 'lucide-react',
        '@heroicons/react': 'lucide-react',
        '@fortawesome/react-fontawesome': 'lucide-react',
        'phosphor-react': 'lucide-react',
        '@tabler/icons-react': 'lucide-react',
        'feather-icons-react': 'lucide-react',
        '@iconify/react': 'lucide-react',
        'react-feather': 'lucide-react'
    },

    // Icon name mappings for common icons
    iconMappings: {
        // FontAwesome → Lucide
        'FaHome': 'Home',
        'FaUser': 'User',
        'FaCog': 'Settings',
        'FaSearch': 'Search',
        'FaPlus': 'Plus',
        'FaTrash': 'Trash2',
        'FaEdit': 'Edit',
        'FaCheck': 'Check',
        'FaTimes': 'X',
        'FaChevronRight': 'ChevronRight',
        'FaChevronDown': 'ChevronDown',
        // HeroIcons → Lucide
        'HomeIcon': 'Home',
        'UserIcon': 'User',
        'CogIcon': 'Settings'
    }
} as const;

// ============================================
// STYLING SYSTEMS
// ============================================
export const STYLING_SYSTEMS = {
    supported: {
        'tailwind': {
            name: 'Tailwind CSS',
            packages: ['tailwindcss', 'autoprefixer', 'postcss'],
            description: 'Utility-first CSS (required, always included)'
        }
    },

    conversions: {
        'styled-components': 'tailwind',
        '@emotion/react': 'tailwind',
        '@emotion/styled': 'tailwind',
        'sass': 'tailwind',
        'less': 'tailwind',
        'styled-jsx': 'tailwind',
        'css-modules': 'tailwind',
        'stitches': 'tailwind',
        'vanilla-extract': 'tailwind'
    }
} as const;

// ============================================
// STATE MANAGEMENT
// ============================================
export const STATE_LIBRARIES = {
    supported: {
        'react-state': {
            name: 'React useState/useReducer',
            packages: [],
            description: 'Built-in React state (default for simple apps)'
        },
        'zustand': {
            name: 'Zustand',
            packages: ['zustand'],
            description: 'Lightweight global state for complex apps'
        },
        'tanstack-query': {
            name: 'TanStack Query',
            packages: ['@tanstack/react-query'],
            description: 'Server state management (API calls)'
        }
    },

    conversions: {
        'redux': 'zustand',
        '@reduxjs/toolkit': 'zustand',
        'react-redux': 'zustand',
        'mobx': 'zustand',
        'mobx-react': 'zustand',
        'recoil': 'zustand',
        'jotai': 'zustand',
        'valtio': 'zustand',
        'xstate': 'zustand'
    }
} as const;

// ============================================
// CHART / VISUALIZATION LIBRARIES
// ============================================
export const CHART_LIBRARIES = {
    supported: {
        'recharts': {
            name: 'Recharts',
            packages: ['recharts'],
            description: 'React-native charting (default for dashboards)'
        }
    },

    conversions: {
        'chart.js': 'recharts',
        'react-chartjs-2': 'recharts',
        '@nivo/core': 'recharts',
        'd3': 'recharts',
        'victory': 'recharts',
        'visx': 'recharts',
        'echarts': 'recharts',
        'echarts-for-react': 'recharts',
        'apexcharts': 'recharts',
        'react-apexcharts': 'recharts'
    }
} as const;

// ============================================
// FORM LIBRARIES
// ============================================
export const FORM_LIBRARIES = {
    supported: {
        'react-hook-form': {
            name: 'React Hook Form',
            packages: ['react-hook-form'],
            description: 'Performant forms with validation'
        },
        'native': {
            name: 'Native React Forms',
            packages: [],
            description: 'Simple useState-based forms (default for simple forms)'
        }
    },

    conversions: {
        'formik': 'react-hook-form',
        'react-final-form': 'react-hook-form',
        'informed': 'react-hook-form'
    }
} as const;

// ============================================
// FRAMEWORK CONSTRAINTS
// ============================================
export const FRAMEWORK_CONSTRAINTS = {
    supported: 'vite-react',

    conversions: {
        'next': 'vite-react',
        'nextjs': 'vite-react',
        'next.js': 'vite-react',
        'remix': 'vite-react',
        'gatsby': 'vite-react',
        'create-react-app': 'vite-react',
        'cra': 'vite-react',
        'webpack': 'vite-react'
    },

    conversionMessage: 'This environment uses Vite + React. Your app will be built with Vite for optimal performance.'
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getUILibraryConversion(requested: string): string {
    const key = requested.toLowerCase();
    return UI_LIBRARIES.conversions[key as keyof typeof UI_LIBRARIES.conversions] || 'shadcn';
}

export function getAnimationLibraryConversion(requested: string): string {
    const key = requested.toLowerCase();
    return ANIMATION_LIBRARIES.conversions[key as keyof typeof ANIMATION_LIBRARIES.conversions] || 'framer-motion';
}

export function getIconLibraryConversion(requested: string): string {
    const key = requested.toLowerCase();
    return ICON_LIBRARIES.conversions[key as keyof typeof ICON_LIBRARIES.conversions] || 'lucide-react';
}

export function isLibrarySupported(library: string): boolean {
    const allSupported = [
        ...Object.keys(UI_LIBRARIES.supported),
        ...Object.keys(ANIMATION_LIBRARIES.supported),
        ...Object.keys(ICON_LIBRARIES.supported),
        ...Object.keys(STYLING_SYSTEMS.supported),
        ...Object.keys(STATE_LIBRARIES.supported),
        ...Object.keys(CHART_LIBRARIES.supported),
        ...Object.keys(FORM_LIBRARIES.supported)
    ];
    return allSupported.some(s => library.toLowerCase().includes(s));
}

// Get all required base packages for a new project
export function getBasePackages(): string[] {
    return [
        // Core React
        'react', 'react-dom',
        // Vite
        'vite', '@vitejs/plugin-react',
        // Tailwind
        'tailwindcss', 'postcss', 'autoprefixer',
        // UI Foundation (shadcn)
        'clsx', 'tailwind-merge', 'class-variance-authority',
        '@radix-ui/react-slot',
        // Icons
        'lucide-react',
        // Animation
        'framer-motion', 'tailwindcss-animate',
        // Charts (for dashboards)
        'recharts',
        // Utilities
        'uuid'
    ];
}

// Generate constraints prompt section for AI
export function getConstraintsPrompt(): string {
    return `
SYSTEM LIBRARY CONSTRAINTS:
===========================
This environment has predefined supported libraries. If the user requests unsupported libraries, convert to supported alternatives.

SUPPORTED LIBRARIES:
- UI Components: shadcn/ui (Radix + Tailwind) - NO Material UI, Chakra, Ant Design
- Animation: Framer Motion, Tailwind Animate - NO GSAP, React Spring
- Icons: Lucide React - NO React Icons, FontAwesome, Heroicons
- Styling: Tailwind CSS ONLY - NO styled-components, Emotion, Sass
- State: React useState, Zustand, TanStack Query - NO Redux, MobX
- Charts: Recharts - NO Chart.js, D3, Nivo
- Forms: React Hook Form - NO Formik
- Framework: Vite + React ONLY - NO Next.js, Remix, CRA

CONVERSION RULES:
- Material UI request → Use shadcn/ui components with Tailwind
- GSAP animation → Use Framer Motion with similar effects
- FontAwesome icons → Use equivalent Lucide icons
- Redux state → Use Zustand for global state
- Next.js request → Build with Vite (ignore SSR/SSG features)

Always acknowledge the conversion:
"I'll build this using [supported library] which provides similar functionality."
`;
}
