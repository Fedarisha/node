variable "TAG" {
    default = "dev"
}

variable "REGISTRIES" {
    default = ["voltara13/node", "ghcr.io/fedarisha/node"]
}

variable "VARIANTS" {
    default = {
        plain = {
            integrations = ""
            suffix       = ""
        }
    }
}

target "node" {
    name = variant

    matrix = {
        variant = ["plain"]
    }

    context    = "."
    dockerfile = "docker/Dockerfile"
    platforms  = ["linux/amd64", "linux/arm64"]

    args = {
        INTEGRATIONS = VARIANTS[variant].integrations
        XRAY_IMAGE = "ghcr.io/fedarisha/xray-core:latest"
    }

    tags = [
        for registry in REGISTRIES : "${registry}:${TAG}${VARIANTS[variant].suffix}"
    ]
}

group "default" {
    targets = ["plain"]
}
