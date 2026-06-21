import { useState, useEffect } from "react";
import type { DeployOptions } from "../../types";
import type { ModelOption, ProfileOption, SourceOption } from "./types";

export function useDeployForm(onDeploy: (opts: DeployOptions) => Promise<void> | void) {
  const [name, setName] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [profileId, setProfileId] = useState("");
  const [model, setModel] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState("");
  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(3);

  useEffect(() => {
    fetch("/api/profiles")
      .then(r => r.json())
      .then(d => setProfiles(d.profiles || []))
      .catch(() => setErr("Could not load profiles — is MongoDB running?"));
  }, []);

  useEffect(() => {
    if (!profileId) {
      setModels([]);
      setModel("");
      return;
    }
    setLoadingMeta(true);
    const profile = profiles.find(p => p.id === profileId);
    fetch(`/api/models?profileId=${encodeURIComponent(profileId)}`)
      .then(r => r.json())
      .then(modelData => {
        const modelList = modelData.models || [];
        setModels(modelList);
        const defaultModel = profile?.defaultModel || modelList[0]?.id || "";
        setModel(prev => prev && modelList.some((m: ModelOption) => m.id === prev) ? prev : defaultModel);
      })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoadingMeta(false));
  }, [profileId, profiles]);

  useEffect(() => {
    if (!profileId) { setSources([]); setSource(""); return; }
    fetch(`/api/job-sources?profileId=${encodeURIComponent(profileId)}`)
      .then(r => r.json())
      .then(d => {
        const list: SourceOption[] = d.sources || [];
        setSources(list);
        setSource(prev => (prev && list.some(s => s.title === prev)) ? prev : (list[0]?.title || ""));
      })
      .catch(() => setSources([]));
  }, [profileId]);

  const selectedSource = sources.find(s => s.title === source);
  const posted = selectedSource?.posted ?? 0;
  const rangeCount = Math.max(0, Math.min(endIndex, posted) - startIndex);
  const valid = name.trim().length > 0 && !!profileId && !!model && !!source && startIndex >= 0 && endIndex > startIndex && rangeCount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) { setErr("Pick a profile, model, job source, and a valid range."); return; }
    setErr("");
    setLoading(true);
    try {
      await onDeploy({
        name: name.trim(),
        autoSubmit,
        profileId,
        model,
        source,
        startIndex,
        endIndex: Math.min(endIndex, posted),
      });
    } catch (e: unknown) {
      setErr(String(e instanceof Error ? e.message : e));
      setLoading(false);
    }
  }

  return {
    name, setName,
    autoSubmit, setAutoSubmit,
    loading, err,
    profiles, models, profileId, setProfileId,
    model, setModel,
    loadingMeta,
    sources, source, setSource,
    startIndex, setStartIndex,
    endIndex, setEndIndex,
    posted, rangeCount, valid,
    handleSubmit,
  };
}
