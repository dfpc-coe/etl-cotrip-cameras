import { Type, TSchema } from '@sinclair/typebox';
import { FeatureCollection, Feature } from 'geojson';
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, env } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';

const InputSchema = Type.Object({
    'DEBUG': Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

const OutputSchema = Type.Object({})

export default class Task extends ETL {
    async schema(type: SchemaType = SchemaType.Input): Promise<TSchema> {
        if (type === SchemaType.Input) {
            return InputSchema;
        } else {
            return OutputSchema;
        }
    }

    async control(): Promise<void> {
        await this.env(InputSchema);

        const features: Feature[] = [];

        const res = await fetch('https://www.cotrip.org/api/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: `
                    query MapFeatures($input: MapFeaturesArgs!) {
                        mapFeaturesQuery(input: $input) {
                            mapFeatures {
                                tooltip
                                features {
                                    id
                                    geometry
                                    properties
                                }
                                ... on Camera {
                                    views(limit: 5) {
                                        ... on CameraView {
                                            sources {
                                                type
                                                src
                                            }
                                        }
                                        category
                                    }
                                }
                            }
                            error {
                                message
                                type
                            }
                        }
                    }
                `,
                variables: {
                    input: {
                        west: -180,
                        south: -85,
                        east: 180,
                        north: 85,
                        zoom: 11,
                        nonClusterableUris: ['dashboard'],
                        layerSlugs: ['normalCameras']
                    }
                }
            })
        })

        const body = await res.typed(Type.Object({
            data: Type.Object({
                mapFeaturesQuery: Type.Object({
                    mapFeatures: Type.Array(Type.Object({
                        tooltip: Type.String(),
                        features: Type.Array(Type.Object({
                            id: Type.String(),
                            properties: Type.Unknown(),
                            geometry: Type.Object({
                                type: Type.Literal('Point'),
                                coordinates: Type.Array(Type.Number())
                            })
                        })),
                        views: Type.Array(Type.Object({
                            category: Type.String(),
                            sources: Type.Union([Type.Array(Type.Object({
                                type: Type.String(),
                                src: Type.String()
                            })), Type.Null()])
                        }))
                    }))
                })
            })
        }));

        for (const camera of body.data.mapFeaturesQuery.mapFeatures) {
            if (!camera.features || !camera.features.length) {
                console.warn(`ok - skipping ${camera.tooltip} - missing feature`)
                continue;
            } else if (!camera.views || !camera.views.length) {
                console.warn(`ok - skipping ${camera.tooltip} - mission sources`)
                continue;
            }

            const feat = camera.features[0];

            if (feat.geometry.coordinates.length < 2) {
                console.warn(`ok - skipping ${camera.tooltip} - invalid coordinates`)
            } else if (feat.geometry.coordinates[0] === 0 && feat.geometry.coordinates[1] === 0) {
                console.warn(`ok - skipping ${camera.tooltip} - null island coordinates`)
            }

            const view = camera.views[0];

            if (!view.sources || !view.sources.length || view.category !== "VIDEO") {
                console.warn(`ok - skipping ${camera.tooltip} - missing streaming video`)
                continue;
            }

            const source = view.sources[0];

            features.push({
                id: feat.id.replace('camera/', ''),
                type: 'Feature',
                properties: {
                    type: 'b-m-p-s-p-loc',
                    callsign: camera.tooltip,
                    video: {
                        sensor: camera.tooltip,
                        url: source.src
                    }
                },
                geometry: feat.geometry
            })
        }

        const fc: FeatureCollection = {
            type: 'FeatureCollection',
            features: features
        }

        await this.submit(fc);
    }
}

env(import.meta.url)
await local(new Task(), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}

