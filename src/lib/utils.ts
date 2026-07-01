// oxlint-disable-next-line typescript/no-extraneous-class
export class Utils {
	static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
