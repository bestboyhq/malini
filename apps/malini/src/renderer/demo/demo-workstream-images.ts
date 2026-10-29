import { demoMediaUrl } from './demo-media';

export { parseWorkstreamImageUrl, WORKSTREAM_IMAGE_SCHEME } from '../../contract/workstream-images';

export function workstreamImageUrl(_workstreamId: string, path: string, _version: number): string {
	return demoMediaUrl(path) ?? '';
}
