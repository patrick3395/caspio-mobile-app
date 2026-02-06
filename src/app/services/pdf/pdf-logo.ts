let cachedLogo: string | null = null;

export async function getLogoBase64(): Promise<string | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const response = await fetch('assets/img/noble-logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    cachedLogo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return cachedLogo;
  } catch {
    return null;
  }
}
