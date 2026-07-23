import type { RepoMappingResponse } from '../dto';

export interface IRepoMappingRepository {
	delete(organizationId: string, projectId: string): Promise<void>;
	findAll(organizationId?: string): Promise<RepoMappingResponse[]>;
	findByOrganizationAndProject(
		organizationId: string,
		projectId: string
	): Promise<RepoMappingResponse | null>;
	insert(row: RepoMappingResponse): Promise<void>;
	update(organizationId: string, projectId: string, repositoryName: string): Promise<void>;
}
