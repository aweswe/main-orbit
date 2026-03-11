const fs = require('fs');
const content = fs.readFileSync('src/hooks/useChat.ts', 'utf-8');

const healStart = content.indexOf('  // ============================================\n  // UNIFIED AUTO-HEALER');
const effectEnd = content.indexOf('  }, [handleAutoHeal, messages]);\n') + '  }, [handleAutoHeal, messages]);\n'.length;

if (healStart !== -1 && effectEnd !== -1) {
    const healBlock = content.substring(healStart, effectEnd);
    let newContent = content.substring(0, healStart) + content.substring(effectEnd);

    // Insert before sendMessage
    const insertIdx = newContent.indexOf('  const sendMessage = useCallback(async (content: string) => {');
    newContent = newContent.substring(0, insertIdx) + healBlock + '\n' + newContent.substring(insertIdx);

    fs.writeFileSync('src/hooks/useChat.ts', newContent);
    console.log('Moved successfully!');
} else {
    console.log('Could not find boundaries.');
}
