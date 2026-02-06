import { useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ProjectFile } from '@/types/chat';
import { ProjectPlan } from '@/types/pipeline';
import * as boilerplate from '@/lib/projectBoilerplate';

export function useProjectExport() {
    const exportProject = useCallback(async (files: ProjectFile[], plan: ProjectPlan | null) => {
        const zip = new JSZip();
        const projectName = plan?.sharedProject?.name || 'my-awesome-project';

        // 1. Add generated files (everything goes in /src)
        files.forEach((file) => {
            // Ensure path is relative and doesn't start with /
            const cleanPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
            zip.file(`src/${cleanPath}`, file.content);
        });

        // 2. Add boilerplate files to the root
        zip.file('package.json', boilerplate.getPackageJson(projectName));
        zip.file('vite.config.ts', boilerplate.getViteConfig());
        zip.file('tailwind.config.ts', boilerplate.getTailwindConfig());
        zip.file('postcss.config.js', boilerplate.getPostcssConfig());
        zip.file('tsconfig.json', boilerplate.getTsConfig());
        zip.file('index.html', boilerplate.getIndexHtml(projectName));
        zip.file('.gitignore', 'node_modules\ndist\n.env\n');

        // 3. Add source boilerplate
        zip.file('src/main.tsx', boilerplate.getMainTsx());
        zip.file('src/index.css', boilerplate.getIndexCss());

        // 4. Generate and download
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `${projectName.toLowerCase().replace(/\s+/g, '-')}.zip`);
    }, []);

    return { exportProject };
}
