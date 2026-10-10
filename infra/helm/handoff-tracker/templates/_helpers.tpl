{{- define "ht.name" -}}{{ .Release.Name }}{{- end }}

{{- define "ht.labels" -}}
app.kubernetes.io/name: handoff-tracker
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "ht.selector" -}}
app.kubernetes.io/name: handoff-tracker
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "ht.secretName" -}}
{{- if .Values.secrets.existingSecret }}{{ .Values.secrets.existingSecret }}{{ else }}{{ include "ht.name" . }}-secrets{{ end -}}
{{- end }}

{{- define "ht.image" -}}
{{ .repository }}:{{ .tag }}
{{- end }}

{{/* Hardened pod and container security, shared by every workload. */}}
{{- define "ht.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
{{- end }}

{{- define "ht.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
{{- end }}

{{/* Environment for app containers: settings from the ConfigMap, secrets from the Secret. */}}
{{- define "ht.env" -}}
envFrom:
  - configMapRef: { name: {{ include "ht.name" . }}-config }
  - secretRef: { name: {{ include "ht.secretName" . }} }
{{- end }}

{{/* NetworkPolicy egress rules shared by several policies. */}}
{{- define "ht.dnsEgress" -}}
- to:
    - namespaceSelector: {}
      podSelector: { matchLabels: { k8s-app: kube-dns } }
  ports:
    - { protocol: UDP, port: 53 }
    - { protocol: TCP, port: 53 }
{{- end }}
{{- define "ht.dbEgress" -}}
- to:
  {{- if .Values.postgres.enabled }}
    - podSelector:
        matchLabels: {{- include "ht.selector" . | nindent 10 }}
          app.kubernetes.io/component: postgres
  {{- else }}
    - ipBlock: { cidr: {{ .Values.networkPolicy.externalDatabaseCidr }} }
  {{- end }}
  ports:
    - { protocol: TCP, port: {{ .Values.networkPolicy.databasePort }} }
{{- end }}
