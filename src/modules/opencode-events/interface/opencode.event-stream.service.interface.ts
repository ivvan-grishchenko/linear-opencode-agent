export interface IOpencodeEventStreamService {
	ensureStream(repositoryName: string): void;
	releaseStream(repositoryName: string): void;
}
