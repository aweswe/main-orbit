import { WebContainer } from '@webcontainer/api';

let webcontainerInstance: WebContainer | undefined;

/**
 * Boots the WebContainer functionality.
 * This should be called once on application startup or when the engine is first needed.
 */
export const getWebContainer = async () => {
    if (!webcontainerInstance) {
        try {
            webcontainerInstance = await WebContainer.boot();
        } catch (error) {
            console.error('Failed to boot WebContainer:', error);
            throw error;
        }
    }
    return webcontainerInstance;
};
