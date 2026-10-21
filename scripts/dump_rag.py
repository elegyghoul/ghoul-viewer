import bpy
from mathutils import Matrix, Vector

import addon_utils
addon_utils.enable("io_scene_gltf2")
print("FILE", bpy.data.filepath)
print("FRAME", bpy.context.scene.frame_current)

def dump(obj, label):
    print("---", label, obj.name, obj.type)
    print("parent", obj.parent.name if obj.parent else None, "bone", obj.parent_bone, "type", obj.parent_type)
    print("loc", tuple(round(v, 5) for v in obj.location))
    print("rot_mode", obj.rotation_mode)
    print("rot_euler", tuple(round(v, 5) for v in obj.rotation_euler))
    print("rot_quat", tuple(round(v, 5) for v in obj.rotation_quaternion))
    print("scale", tuple(round(v, 5) for v in obj.scale))
    print("delta_loc", tuple(round(v, 5) for v in obj.delta_location))
    print("delta_scale", tuple(round(v, 5) for v in obj.delta_scale))
    print("matrix_parent_inverse")
    for row in obj.matrix_parent_inverse:
        print(" ", tuple(round(v, 5) for v in row))
    mw = obj.matrix_world
    loc, rot, scale = mw.decompose()
    print("world_loc", tuple(round(v, 5) for v in loc))
    print("world_scale", tuple(round(v, 5) for v in scale))
    if obj.type == "MESH":
        me = obj.data
        print("mesh", me.name, "verts", len(me.vertices), "users", me.users, "mats", [m.name if m else None for m in me.materials])
        if me.vertices:
            xs = [v.co.x for v in me.vertices]
            ys = [v.co.y for v in me.vertices]
            zs = [v.co.z for v in me.vertices]
            print("local_bbox", (round(min(xs), 5), round(min(ys), 5), round(min(zs), 5)), (round(max(xs), 5), round(max(ys), 5), round(max(zs), 5)))
        print("modifiers", [(m.name, m.type) for m in obj.modifiers])
        print("constraints", [(c.name, c.type) for c in obj.constraints])
    print("keys", list(obj.keys()))
    for k in obj.keys():
        val = obj[k]
        print(" prop", k, type(val).__name__, val)
    if obj.type == "MESH":
        print("mesh keys", list(obj.data.keys()))
        for k in obj.data.keys():
            print(" meshprop", k, obj.data[k])

rag = bpy.data.objects.get("Rag")
if rag:
    dump(rag, "OBJ")
    ad = rag.animation_data
    print("anim_data", ad is not None)
    if ad:
        print("action", ad.action.name if ad.action else None)
        print("nla", [(t.name, t.mute, [(s.name, s.action.name if s.action else None) for s in t.strips]) for t in ad.nla_tracks])
        print("drivers", [(d.data_path, d.array_index) for d in (ad.drivers or [])])
    if hasattr(rag, "gltf2_animation_rest"):
        M = rag.gltf2_animation_rest
        mat = Matrix(M)
        loc, rot, sca = mat.decompose()
        print("REST loc", tuple(round(v, 5) for v in loc))
        print("REST quat", tuple(round(v, 5) for v in rot))
        print("REST scale", tuple(round(v, 5) for v in sca))
        print("REST is identity", all(abs(mat[i][j] - (1 if i == j else 0)) < 1e-5 for i in range(4) for j in range(4)))
    raise SystemExit

act = bpy.data.actions.get("Idle")
if act and rag and rag.animation_data:
    slot = rag.animation_data.action_slot
    print("active slot", slot, "identifier", getattr(slot, "identifier", None), "handle", getattr(slot, "handle", None))
    print("layers", len(act.layers))
    for li, layer in enumerate(act.layers):
        for si, strip in enumerate(layer.strips):
            print(" strip", li, si, type(strip).__name__)
            try:
                bags = list(strip.channelbags) if hasattr(strip, "channelbags") else []
            except Exception:
                bags = []
            if not bags and slot is not None:
                try:
                    bag = strip.channelbag(slot)
                    bags = [bag] if bag else []
                except Exception as e:
                    print(" bag err", e)
            for bag in bags:
                bslot = getattr(bag, "slot", None)
                print(" bag slot", getattr(bslot, "identifier", bslot), "fcurves", len(bag.fcurves))
                for fc in bag.fcurves:
                    if fc.data_path not in ("location", "rotation_quaternion", "scale", "rotation_euler"):
                        continue
                    vals = []
                    for kp in list(fc.keyframe_points)[:2]:
                        vals.append(round(kp.co[1], 5))
                    print(" ", fc.data_path, fc.array_index, "n", len(fc.keyframe_points), "first", vals)

# Also meshes named rag that might be unlinked
for me in bpy.data.meshes:
    if "rag" in me.name.lower():
        print("MESHDATA", me.name, "verts", len(me.vertices), "users", me.users)
